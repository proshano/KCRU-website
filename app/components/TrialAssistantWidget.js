'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const INITIAL_ASSISTANT_MESSAGE =
  "Start with the diagnosis and share the eGFR, or just say the patient is on dialysis. I'll narrow down the recruiting studies from there."

const MAX_INPUT_LENGTH = 600

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

const AUTO_OPEN_PATHS = new Set([])
const HIDDEN_PATH_PREFIXES = [
  '/admin',
  '/login',
  '/protected',
  '/trials/manage',
  '/trials/approvals',
  '/updates/admin',
  '/under-construction',
]
const PANEL_ID = 'trial-assistant-panel'
const TITLE_ID = 'trial-assistant-title'
const INPUT_ID = 'trial-assistant-input'
const HELP_ID = 'trial-assistant-help'
const ERROR_ID = 'trial-assistant-error'
const LAUNCHER_PULSE_SESSION_KEY = 'kcruTrialAssistantLauncherPulseDone'

function readLauncherPulseSuppressed() {
  if (typeof window === 'undefined') return true
  try {
    return sessionStorage.getItem(LAUNCHER_PULSE_SESSION_KEY) === '1'
  } catch {
    return true
  }
}

function writeLauncherPulseSuppressed() {
  try {
    sessionStorage.setItem(LAUNCHER_PULSE_SESSION_KEY, '1')
  } catch {
    /* ignore */
  }
}

function createInitialMessages() {
  return [{ role: 'assistant', content: INITIAL_ASSISTANT_MESSAGE }]
}

function shouldHideWidget(pathname) {
  if (!pathname) return false
  return HIDDEN_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function decisionBadge(decision) {
  if (decision === 'match') {
    return {
      label: 'Strongest match',
      className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    }
  }

  if (decision === 'possible') {
    return {
      label: 'Possible match',
      className: 'bg-sky-50 text-sky-800 border-sky-200',
    }
  }

  if (decision === 'insufficient_info') {
    return {
      label: 'Needs more detail',
      className: 'bg-amber-50 text-amber-800 border-amber-200',
    }
  }

  return {
    label: 'Unlikely fit',
    className: 'bg-gray-50 text-gray-700 border-gray-200',
  }
}

function statusLabel(status) {
  if (status === 'recruiting') return 'Recruiting'
  return 'Status unavailable'
}

function LauncherIcon({ className = 'h-6 w-6' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
      <path d="M11 8.5v5" />
      <path d="M8.5 11h5" />
    </svg>
  )
}

function ResultReasonList({ title, reasons }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <ul className="space-y-1 text-xs text-gray-700">
        {reasons.slice(0, 2).map((reason) => (
          <li key={reason}>• {reason}</li>
        ))}
      </ul>
    </div>
  )
}

export default function TrialAssistantWidget() {
  const pathname = usePathname()
  const shouldAutoOpenInitially = AUTO_OPEN_PATHS.has(pathname)
  const launcherRef = useRef(null)
  const inputRef = useRef(null)
  const formRef = useRef(null)
  const logRef = useRef(null)
  const loadingMessageRef = useRef(null)
  const latestAssistantMessageRef = useRef(null)
  const resultsSectionRef = useRef(null)
  const lastPathnameRef = useRef(pathname)
  const autoScrollTargetRef = useRef(null)
  const recognitionRef = useRef(null)
  const voiceBaseRef = useRef('')
  const voiceSessionFinalRef = useRef('')
  const [messages, setMessages] = useState(() => createInitialMessages())
  const [input, setInput] = useState('')
  const [profile, setProfile] = useState({})
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationComplete, setConversationComplete] = useState(false)
  const [isExpanded, setIsExpanded] = useState(shouldAutoOpenInitially)
  const [hasAutoOpened, setHasAutoOpened] = useState(shouldAutoOpenInitially)
  const [shouldFocusInput, setShouldFocusInput] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [launcherPulse, setLauncherPulse] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [floatingViewport, setFloatingViewport] = useState({
    bottomOffset: 0,
    viewportHeight: null,
    isSmallScreen: false,
  })

  const visibleResults = results.filter((result) => result.decision !== 'unlikely')
  const fallbackResults = visibleResults.length ? visibleResults : results
  const chatLocked = conversationComplete && !loading
  const isHidden = shouldHideWidget(pathname)
  useEffect(() => {
    if (hasAutoOpened || !AUTO_OPEN_PATHS.has(pathname)) return
    setIsExpanded(true)
    setHasAutoOpened(true)
  }, [hasAutoOpened, pathname])

  useEffect(() => {
    if (!isExpanded || !shouldFocusInput) return
    inputRef.current?.focus()
    setShouldFocusInput(false)
  }, [isExpanded, shouldFocusInput])

  useEffect(() => {
    if (!isExpanded) return
    if (!autoScrollTargetRef.current) return
    if (typeof window === 'undefined') return

    const frame = window.requestAnimationFrame(() => {
      const logNode = logRef.current
      const target =
        autoScrollTargetRef.current === 'loading'
          ? loadingMessageRef.current
          : autoScrollTargetRef.current === 'results'
            ? resultsSectionRef.current || latestAssistantMessageRef.current
            : latestAssistantMessageRef.current || loadingMessageRef.current

      if (logNode && target) {
        const targetTop = Math.max(0, target.offsetTop - logNode.offsetTop - 12)
        const targetBottom = Math.max(0, target.offsetTop - logNode.offsetTop - logNode.clientHeight + target.clientHeight + 16)
        const nextTop = autoScrollTargetRef.current === 'loading' ? targetBottom : targetTop
        logNode.scrollTo({ top: nextTop, behavior: 'smooth' })
      }

      if (!loading) {
        autoScrollTargetRef.current = null
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isExpanded, loading, messages, results])

  useEffect(() => {
    setVoiceSupported(!!getSpeechRecognitionConstructor())
  }, [])

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    if (readLauncherPulseSuppressed()) return
    setLauncherPulse(true)
  }, [])

  useEffect(() => {
    const previousPathname = lastPathnameRef.current
    lastPathnameRef.current = pathname

    if (!previousPathname || previousPathname === pathname) return
    if (!isExpanded || !floatingViewport.isSmallScreen) return

    stopVoiceRecognition()
    setShouldFocusInput(false)
    setInputFocused(false)
    setIsExpanded(false)
  }, [floatingViewport.isSmallScreen, isExpanded, pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const updateFloatingViewport = () => {
      const visualViewport = window.visualViewport
      const isSmallScreen = window.innerWidth < 640

      if (!visualViewport) {
        setFloatingViewport({
          bottomOffset: 0,
          viewportHeight: window.innerHeight,
          isSmallScreen,
        })
        return
      }

      const bottomOffset = Math.max(
        0,
        Math.round(window.innerHeight - (visualViewport.height + visualViewport.offsetTop))
      )

      setFloatingViewport({
        bottomOffset,
        viewportHeight: Math.round(visualViewport.height),
        isSmallScreen,
      })
    }

    updateFloatingViewport()

    const visualViewport = window.visualViewport
    visualViewport?.addEventListener('resize', updateFloatingViewport)
    visualViewport?.addEventListener('scroll', updateFloatingViewport)
    window.addEventListener('resize', updateFloatingViewport)

    return () => {
      visualViewport?.removeEventListener('resize', updateFloatingViewport)
      visualViewport?.removeEventListener('scroll', updateFloatingViewport)
      window.removeEventListener('resize', updateFloatingViewport)
    }
  }, [])

  function stopVoiceRecognition() {
    try {
      recognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    recognitionRef.current = null
    setVoiceListening(false)
  }

  function toggleVoiceRecognition() {
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition || loading || chatLocked) return

    if (voiceListening) {
      stopVoiceRecognition()
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-CA'
    recognition.interimResults = true
    recognition.continuous = true
    voiceBaseRef.current = input.trim()
    voiceSessionFinalRef.current = ''
    recognitionRef.current = recognition

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const piece = result[0]?.transcript ?? ''
        if (result.isFinal) {
          voiceSessionFinalRef.current = `${voiceSessionFinalRef.current}${piece}`
        } else {
          interim += piece
        }
      }
      const combined = `${voiceBaseRef.current} ${voiceSessionFinalRef.current} ${interim}`
        .replace(/\s+/g, ' ')
        .trim()
      setInput(combined.slice(0, MAX_INPUT_LENGTH))
    }

    recognition.onerror = () => {
      stopVoiceRecognition()
    }

    recognition.onend = () => {
      recognitionRef.current = null
      setVoiceListening(false)
    }

    try {
      setVoiceListening(true)
      recognition.start()
    } catch {
      setVoiceListening(false)
    }
  }

  if (isHidden) {
    return null
  }

  function openAssistant() {
    writeLauncherPulseSuppressed()
    setLauncherPulse(false)
    setIsExpanded(true)
    setShouldFocusInput(true)
  }

  function handleLauncherPulseEnd() {
    writeLauncherPulseSuppressed()
    setLauncherPulse(false)
  }

  function minimizeAssistant() {
    stopVoiceRecognition()
    setShouldFocusInput(false)
    setInputFocused(false)
    setIsExpanded(false)
    window.requestAnimationFrame(() => {
      launcherRef.current?.focus()
    })
  }

  function resetAssistant() {
    stopVoiceRecognition()
    autoScrollTargetRef.current = 'response'
    setMessages(createInitialMessages())
    setInput('')
    setProfile({})
    setResults([])
    setConversationComplete(false)
    setError('')
    setLoading(false)
    setInputFocused(false)
    setIsExpanded(true)
    setShouldFocusInput(true)
  }

  const isMobileSheet = floatingViewport.isSmallScreen
  const floatingBottomBase = floatingViewport.isSmallScreen ? 16 : 24
  const floatingDockStyle = isMobileSheet
    ? {
        bottom: `${floatingViewport.bottomOffset}px`,
      }
    : {
        bottom: `calc(env(safe-area-inset-bottom) + ${floatingBottomBase + floatingViewport.bottomOffset}px)`,
      }
  const panelMaxHeight = floatingViewport.viewportHeight
    ? `calc(${floatingViewport.viewportHeight}px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - ${floatingBottomBase + floatingViewport.bottomOffset + 16}px)`
    : 'calc(100dvh - env(safe-area-inset-top) - max(1.25rem, env(safe-area-inset-bottom)) - 1rem)'
  const mobileSheetHeight = floatingViewport.viewportHeight
    ? `${Math.max(0, floatingViewport.viewportHeight - 8)}px`
    : 'calc(100dvh - 0.5rem)'
  const panelStyle = isMobileSheet
    ? {
        height: mobileSheetHeight,
        maxHeight: mobileSheetHeight,
      }
    : {
        height: 'min(78dvh, 42rem)',
        maxHeight: panelMaxHeight,
      }

  function handleAssistantNavigation() {
    if (!isMobileSheet) return
    stopVoiceRecognition()
    setShouldFocusInput(false)
    setInputFocused(false)
    setIsExpanded(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading || chatLocked) return

    stopVoiceRecognition()

    const userMessage = { role: 'user', content: trimmed }
    const nextMessages = [...messages, userMessage]

    autoScrollTargetRef.current = 'loading'
    setMessages(nextMessages)
    setInput('')
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/trials/match/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          profile,
        }),
      })

      const data = await response.json()
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Unable to continue the chat right now.')
      }

      const assistantMessage = {
        role: 'assistant',
        content:
          data.reply ||
          'Share the diagnosis and the eGFR, or just say the patient is on dialysis.',
      }

      autoScrollTargetRef.current =
        Array.isArray(data.results) && data.results.length > 0 ? 'results' : 'response'
      setMessages([...nextMessages, assistantMessage])
      setProfile(data.profile || {})
      setResults(Array.isArray(data.results) ? data.results : [])
      setConversationComplete(Boolean(data.conversationComplete))
      setIsExpanded(true)
    } catch (err) {
      setError(err.message || 'Unable to continue the chat right now.')
    } finally {
      setLoading(false)
    }
  }

  if (!isExpanded) {
    return (
      <div
        className="fixed z-[60] flex justify-center [left:max(0.75rem,env(safe-area-inset-left))] [right:max(0.75rem,env(safe-area-inset-right))] sm:left-auto sm:right-6 sm:justify-end"
        style={floatingDockStyle}
      >
        <button
          ref={launcherRef}
          type="button"
          onClick={openAssistant}
          aria-haspopup="dialog"
          aria-expanded="false"
          className="relative flex w-full max-w-[18rem] min-h-[2.875rem] touch-manipulation items-center gap-[0.45rem] rounded-full border border-white/15 bg-purple px-3 py-[0.6125rem] text-left text-white shadow-lg transition duration-200 active:scale-[0.99] active:bg-purple/95 hover:bg-purple/90 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1 sm:max-w-[15.4rem] sm:min-h-[2.8rem] sm:gap-[0.7rem] sm:px-[1.05rem] sm:py-[0.7rem]"
        >
          {launcherPulse ? (
            <span
              aria-hidden="true"
              onAnimationEnd={handleLauncherPulseEnd}
              className="pointer-events-none absolute inset-0 rounded-full bg-purple/35 opacity-60 motion-reduce:animate-none motion-reduce:opacity-0 animate-[ping_2.8s_cubic-bezier(0,0,0.2,1)_1]"
            />
          ) : null}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/25" />
          <span className="relative flex min-w-0 flex-1 items-center gap-[0.45rem] sm:gap-[0.7rem]">
            <span className="flex h-[1.85rem] w-[1.85rem] shrink-0 items-center justify-center rounded-full bg-white/15 sm:h-[2.1rem] sm:w-[2.1rem]">
              <LauncherIcon className="h-[1rem] w-[1rem] sm:h-[1.225rem] sm:w-[1.225rem]" />
            </span>
            <span className="min-w-0 whitespace-nowrap text-[0.9rem] font-semibold leading-none tracking-[-0.01em] sm:text-base sm:leading-snug sm:tracking-normal">
              Find studies for your patients
            </span>
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      className={`fixed z-[60] flex justify-center ${isMobileSheet ? 'inset-x-0 top-0 items-end' : '[left:max(0.75rem,env(safe-area-inset-left))] [right:max(0.75rem,env(safe-area-inset-right))] sm:left-auto sm:right-6 sm:justify-end'}`}
      style={floatingDockStyle}
    >
      {isMobileSheet ? (
        <button
          type="button"
          onClick={minimizeAssistant}
          aria-label="Close trial assistant"
          className="absolute inset-0 bg-black/10 backdrop-blur-[1.5px]"
        />
      ) : null}
      <aside
        id={PANEL_ID}
        aria-labelledby={TITLE_ID}
        className={`relative flex w-full flex-col overflow-hidden border border-black/10 bg-white ${isMobileSheet ? 'max-w-none rounded-t-[1.5rem] rounded-b-none border-x-0 border-b-0 shadow-[0_-18px_48px_rgba(0,0,0,0.18)]' : 'max-w-[22rem] rounded-2xl shadow-2xl sm:max-w-[24rem]'}`}
        style={panelStyle}
      >
        <div className={`flex items-start justify-between gap-2 border-b border-black/5 bg-gray-50 ${isMobileSheet ? 'px-4 py-3' : 'px-3 py-3 sm:gap-3 sm:px-4 sm:py-4'}`}>
          <div className="min-w-0 flex-1">
            <h2 id={TITLE_ID} className="text-base font-semibold tracking-tight text-gray-900">Trial assistant</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={resetAssistant}
              className={`touch-manipulation whitespace-nowrap border border-black/10 bg-white font-medium text-gray-700 transition active:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 ${isMobileSheet ? 'min-h-10 rounded-xl px-3 text-[13px]' : 'min-h-9 rounded-lg px-2.5 text-[13px] sm:min-h-11 sm:rounded-xl sm:px-3.5 sm:text-sm'}`}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={minimizeAssistant}
              className={`touch-manipulation whitespace-nowrap border border-black/10 bg-white font-medium text-gray-700 transition active:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 ${isMobileSheet ? 'min-h-10 rounded-xl px-3 text-[13px]' : 'min-h-9 rounded-lg px-2.5 text-[13px] sm:min-h-11 sm:rounded-xl sm:px-3.5 sm:text-sm'}`}
              aria-label="Minimize trial assistant"
            >
              Minimize
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={loading}
            className={`flex-1 overflow-y-auto overscroll-y-contain ${isMobileSheet ? 'space-y-3 px-4 py-4' : 'space-y-3 px-3 py-3 sm:space-y-4 sm:px-4 sm:py-4'}`}
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {messages.map((message, index) => {
              const isAssistant = message.role === 'assistant'
              const isLatestAssistantMessage = isAssistant && index === messages.length - 1
              return (
                <div
                  key={`${message.role}-${index}`}
                  ref={isLatestAssistantMessage ? latestAssistantMessageRef : null}
                  className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      isAssistant
                        ? 'bg-gray-50 text-gray-800 border border-black/5'
                        : 'bg-purple text-white'
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              )
            })}

            {loading && (
              <div ref={loadingMessageRef} className="flex justify-start">
                <div className="rounded-2xl border border-black/5 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  <span className="inline-flex items-center gap-2">
                    <span className="animate-pulse">Looking for studies</span>
                    <span className="inline-flex gap-1" aria-hidden="true">
                      <span className="h-1 w-1 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1 w-1 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1 w-1 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                    </span>
                  </span>
                </div>
              </div>
            )}

            {fallbackResults.length > 0 && (
              <div ref={resultsSectionRef} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Possible studies</p>
                  <Link
                    href="/trials"
                    prefetch={false}
                    onClick={handleAssistantNavigation}
                    className="touch-manipulation text-xs font-medium text-purple hover:text-purple/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 sm:text-sm"
                  >
                    View all studies
                  </Link>
                </div>

                {fallbackResults.map((result) => {
                  const badge = decisionBadge(result.decision)
                  return (
                    <article key={result._id} className="space-y-3 rounded-xl border border-black/5 bg-gray-50 p-3 sm:p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          {result.slug ? (
                            <h3 className="text-sm font-semibold leading-snug text-gray-900">
                              <Link
                                href={`/trials/${result.slug}`}
                                prefetch={false}
                                onClick={handleAssistantNavigation}
                                className="touch-manipulation rounded-sm hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
                              >
                                {result.title}
                              </Link>
                            </h3>
                          ) : (
                            <h3 className="text-sm font-semibold text-gray-900">{result.title}</h3>
                          )}
                          <p className="text-xs text-gray-600">{statusLabel(result.status)}</p>
                        </div>
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold sm:text-[11px] ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>

                      <ResultReasonList title="Why it may fit" reasons={result.matchedReasons} />
                      <ResultReasonList title="Still needs clarification" reasons={result.missingReasons} />
                      <ResultReasonList
                        title="Why it looks unlikely"
                        reasons={result.decision === 'unlikely' ? result.mismatchReasons : []}
                      />
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          <div
            className={`space-y-3 border-t border-black/5 bg-white ${isMobileSheet ? 'px-4 pt-3' : 'px-3 py-3 sm:px-4 sm:py-4'}`}
            style={isMobileSheet ? { paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' } : undefined}
          >
            {error && (
              <p id={ERROR_ID} role="alert" className="text-sm font-medium text-red-700">
                {error}
              </p>
            )}
            {chatLocked ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p id={HELP_ID} className="text-sm leading-relaxed text-gray-600">
                  Results are shown above. Press Reset to start a new search.
                </p>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="min-h-10 w-full rounded-xl bg-gray-300 px-4 py-2 text-sm font-semibold text-white sm:min-h-11 sm:w-auto sm:shrink-0"
                >
                  Send
                </button>
              </div>
            ) : (
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
                <label htmlFor={INPUT_ID} className="sr-only">
                  Enter non-identifying diagnosis and eGFR, or say the patient is on dialysis
                </label>
                <div className="flex items-start gap-2">
                  <textarea
                    ref={inputRef}
                    id={INPUT_ID}
                    aria-describedby={error ? `${HELP_ID} ${ERROR_ID}` : HELP_ID}
                    value={input}
                    onChange={(event) => setInput(event.target.value.slice(0, MAX_INPUT_LENGTH))}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      if (event.shiftKey) return
                      if (event.isComposing) return
                      event.preventDefault()
                      if (loading || chatLocked || !input.trim()) return
                      formRef.current?.requestSubmit?.()
                    }}
                    rows={isMobileSheet ? 2 : 3}
                    maxLength={MAX_INPUT_LENGTH}
                    placeholder="Diagnosis and eGFR, or say the patient is on dialysis."
                    className={`flex-1 rounded-xl border border-black/10 px-4 py-3 text-base focus:border-purple focus:outline-none focus:ring-2 focus:ring-purple/30 sm:text-sm ${isMobileSheet ? 'min-h-[4rem]' : 'min-h-[4.5rem] sm:min-h-[5.5rem]'}`}
                  />
                  {voiceSupported ? (
                    <button
                      type="button"
                      onClick={toggleVoiceRecognition}
                      disabled={loading}
                      aria-pressed={voiceListening}
                      title={voiceListening ? 'Stop dictation' : 'Dictate with microphone'}
                      aria-label={voiceListening ? 'Stop voice input' : 'Start voice input'}
                      className={`flex shrink-0 touch-manipulation items-center justify-center self-start rounded-xl border text-sm font-semibold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 disabled:opacity-50 ${isMobileSheet ? 'h-11 w-11' : 'h-10 w-10 sm:h-11 sm:w-11'} ${
                        voiceListening
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : 'border-black/10 bg-white text-gray-700 active:bg-gray-50 hover:border-purple/30'
                      }`}
                    >
                      <span className="sr-only">{voiceListening ? 'Stop' : 'Microphone'}</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-5 w-5"
                        aria-hidden
                      >
                        <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 1 1-10 0H5a7 7 0 0 0 6 6.92V20H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2z" />
                      </svg>
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  {!(isMobileSheet && inputFocused) ? (
                    <p id={HELP_ID} className="text-sm leading-relaxed text-gray-600">
                      Non-identifying details only. No names, birth dates, phone numbers, or record numbers. Data are not stored.
                    </p>
                  ) : (
                    <p id={HELP_ID} className="sr-only">
                      Non-identifying details only. No names, birth dates, phone numbers, or record numbers. Data are not stored.
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="min-h-10 w-full touch-manipulation rounded-xl bg-purple px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.99] active:bg-purple/95 hover:bg-purple/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 disabled:scale-100 disabled:bg-gray-300 disabled:text-white disabled:opacity-100 sm:min-h-11 sm:w-auto sm:shrink-0"
                  >
                    {loading ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
