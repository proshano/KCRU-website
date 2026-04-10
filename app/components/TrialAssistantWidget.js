'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const INITIAL_ASSISTANT_MESSAGE =
  'Does your patient qualify for a trial? Share de-identified major inclusion details: primary kidney diagnosis (for example IgAN or lupus nephritis), eGFR (mL/min/1.73 m²) if known, key comorbidities (for example diabetes, hypertension), and relevant medications.'

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
  const recognitionRef = useRef(null)
  const voiceBaseRef = useRef('')
  const voiceSessionFinalRef = useRef('')
  const [messages, setMessages] = useState(() => createInitialMessages())
  const [input, setInput] = useState('')
  const [profile, setProfile] = useState({})
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(shouldAutoOpenInitially)
  const [hasAutoOpened, setHasAutoOpened] = useState(shouldAutoOpenInitially)
  const [shouldFocusInput, setShouldFocusInput] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)

  const visibleResults = results.filter((result) => result.decision !== 'unlikely')
  const fallbackResults = visibleResults.length ? visibleResults : results
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
    if (!SpeechRecognition || loading) return

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
    setIsExpanded(true)
    setShouldFocusInput(true)
  }

  function minimizeAssistant() {
    setIsExpanded(false)
    window.requestAnimationFrame(() => {
      launcherRef.current?.focus()
    })
  }

  function resetAssistant() {
    stopVoiceRecognition()
    setMessages(createInitialMessages())
    setInput('')
    setProfile({})
    setResults([])
    setError('')
    setLoading(false)
    setIsExpanded(true)
    setShouldFocusInput(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading) return

    stopVoiceRecognition()

    const userMessage = { role: 'user', content: trimmed }
    const nextMessages = [...messages, userMessage]

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
          'Add diagnosis and eGFR if known.',
      }

      setMessages([...nextMessages, assistantMessage])
      setProfile(data.profile || {})
      setResults(Array.isArray(data.results) ? data.results : [])
      setIsExpanded(true)
    } catch (err) {
      setError(err.message || 'Unable to continue the chat right now.')
    } finally {
      setLoading(false)
    }
  }

  if (!isExpanded) {
    return (
      <div className="fixed z-[60] [bottom:max(1rem,env(safe-area-inset-bottom))] [right:max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6">
        <button
          ref={launcherRef}
          type="button"
          onClick={openAssistant}
          aria-controls={PANEL_ID}
          aria-expanded="false"
          aria-label="Open trial assistant"
          className="min-h-11 rounded-full border border-black/10 bg-white px-4 py-3 shadow-lg transition hover:border-purple/30 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
        >
          <span className="block text-sm font-semibold text-gray-900 text-left">Trial assistant</span>
          <span className="block text-sm text-gray-600 text-left">Find studies for your patients</span>
        </button>
      </div>
    )
  }

  return (
    <div className="fixed z-[60] [bottom:max(1rem,env(safe-area-inset-bottom))] [right:max(1rem,env(safe-area-inset-right))] sm:bottom-6 sm:right-6">
      <aside
        id={PANEL_ID}
        aria-labelledby={TITLE_ID}
        className="flex w-[calc(100vw-2rem)] max-w-[24rem] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl"
        style={{ height: 'min(72vh, 42rem)' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-4 py-4 bg-gray-50">
          <div>
            <h2 id={TITLE_ID} className="text-base font-semibold tracking-tight text-gray-900">Trial matching assistant</h2>
            <p className="text-sm text-gray-600">Minimize to keep browsing</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetAssistant}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-gray-600 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={minimizeAssistant}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-gray-600 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
              aria-label="Minimize trial assistant"
            >
              Minimize
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={loading}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
          >
            {messages.map((message, index) => {
              const isAssistant = message.role === 'assistant'
              return (
                <div key={`${message.role}-${index}`} className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
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
              <div className="flex justify-start">
                <div className="rounded-2xl border border-black/5 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  Thinking...
                </div>
              </div>
            )}

            {fallbackResults.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Possible studies</p>
                  <Link
                    href="/trials"
                    prefetch={false}
                    className="text-sm font-medium text-purple hover:text-purple/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
                  >
                    View all studies
                  </Link>
                </div>

                {fallbackResults.map((result) => {
                  const badge = decisionBadge(result.decision)
                  return (
                    <article key={result._id} className="rounded-xl border border-black/5 bg-gray-50 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          {result.slug ? (
                            <h3 className="text-sm font-semibold leading-snug text-gray-900">
                              <Link
                                href={`/trials/${result.slug}`}
                                prefetch={false}
                                className="hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 rounded-sm"
                              >
                                {result.title}
                              </Link>
                            </h3>
                          ) : (
                            <h3 className="text-sm font-semibold text-gray-900">{result.title}</h3>
                          )}
                          <p className="text-xs text-gray-600">{statusLabel(result.status)}</p>
                        </div>
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${badge.className}`}>
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

          <div className="border-t border-black/5 px-4 py-4 space-y-3">
            {error && (
              <p id={ERROR_ID} role="alert" className="text-sm font-medium text-red-700">
                {error}
              </p>
            )}
            <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
              <label htmlFor={INPUT_ID} className="sr-only">
                Describe non-identifying patient characteristics
              </label>
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  id={INPUT_ID}
                  aria-describedby={error ? `${HELP_ID} ${ERROR_ID}` : HELP_ID}
                  value={input}
                  onChange={(event) => setInput(event.target.value.slice(0, MAX_INPUT_LENGTH))}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    if (event.shiftKey) return
                    if (event.isComposing) return
                    event.preventDefault()
                    if (loading || !input.trim()) return
                    formRef.current?.requestSubmit?.()
                  }}
                  rows={3}
                  maxLength={MAX_INPUT_LENGTH}
                  placeholder="De-identified: diagnosis, eGFR, key meds, comorbidities."
                  className="min-h-[5.5rem] flex-1 rounded-xl border border-black/10 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple/30 focus:border-purple"
                />
                {voiceSupported ? (
                  <button
                    type="button"
                    onClick={toggleVoiceRecognition}
                    disabled={loading}
                    aria-pressed={voiceListening}
                    title={voiceListening ? 'Stop dictation' : 'Dictate with microphone'}
                    aria-label={voiceListening ? 'Stop voice input' : 'Start voice input'}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 disabled:opacity-50 ${
                      voiceListening
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : 'border-black/10 bg-white text-gray-700 hover:border-purple/30'
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
                <p id={HELP_ID} className="text-sm leading-relaxed text-gray-600">
                  Non-identifying details only. Avoid names, birth dates, phone numbers, and record numbers.
                </p>
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="min-h-11 self-end rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 disabled:opacity-50 sm:shrink-0"
                >
                  {loading ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </aside>
    </div>
  )
}
