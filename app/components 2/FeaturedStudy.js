'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function FeaturedStudy({ trials = [] }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [displayTitle, setDisplayTitle] = useState('')
  const [displayDesc, setDisplayDesc] = useState('')
  const [isTyping, setIsTyping] = useState(true)

  useEffect(() => {
    if (trials.length === 0) return

    const trial = trials[currentIndex]
    const title = trial.title || 'Study'
    const desc = `${trial.purpose || trial.condition || 'Research study'}`

    let titleIndex = 0
    let descIndex = 0
    let phase = 'title' // 'title', 'desc', 'wait'

    setDisplayTitle('')
    setDisplayDesc('')
    setIsTyping(true)

    const typeInterval = setInterval(() => {
      if (phase === 'title') {
        if (titleIndex < title.length) {
          setDisplayTitle(title.slice(0, titleIndex + 1))
          titleIndex++
        } else {
          phase = 'desc'
        }
      } else if (phase === 'desc') {
        if (descIndex < desc.length) {
          setDisplayDesc(desc.slice(0, descIndex + 1))
          descIndex++
        } else {
          phase = 'wait'
          setIsTyping(false)
          clearInterval(typeInterval)

          // Wait before next study
          setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % trials.length)
          }, 4000)
        }
      }
    }, 25)

    return () => clearInterval(typeInterval)
  }, [currentIndex, trials])

  if (trials.length === 0) return null

  const trial = trials[currentIndex]
  const slugValue = typeof trial.slug === 'string' ? trial.slug : trial.slug?.current
  const href = slugValue ? `/trials/${slugValue}` : '/trials'

  return (
    <div className="mt-8 p-7 bg-gradient-to-br from-[#F5F3F0] to-[#EEEBE6] relative overflow-hidden">
      {/* Recruiting ribbon */}
      {trial.status === 'recruiting' && (
        <div className="recruiting-ribbon">RECRUITING</div>
      )}

      <div className="space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.1em] text-[#888] mb-2 font-semibold">
            Featured Study
          </div>
          <div className={`text-xl font-bold tracking-tight min-h-[1.2em] ${isTyping ? 'typing-cursor' : ''}`}>
            {displayTitle}
          </div>
          <div className="text-sm text-[#666] mt-1 font-normal leading-relaxed min-h-[1.5em]">
            {displayDesc}
          </div>
        </div>

        <Link href={href} className="arrow-link text-[13px]">
          Learn more
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </Link>
      </div>
    </div>
  )
}
