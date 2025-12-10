'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function FeaturedStudy({ trials = [] }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (trials.length <= 1) return

    const interval = setInterval(() => {
      setIsVisible(false)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % trials.length)
        setIsVisible(true)
      }, 300)
    }, 5000)

    return () => clearInterval(interval)
  }, [trials.length])

  if (trials.length === 0) return null

  const trial = trials[currentIndex]
  const slugValue = typeof trial.slug === 'string' ? trial.slug : trial.slug?.current
  const href = slugValue ? `/trials/${slugValue}` : '/trials'
  const title = trial.title || 'Study'
  const desc = trial.purpose || trial.condition || 'Research study'

  return (
    <div 
      className="mt-8 p-7 bg-gradient-to-br from-[#F5F3F0] to-[#EEEBE6] relative overflow-hidden"
      style={{ height: '200px', minHeight: '200px', maxHeight: '200px', flexShrink: 0 }}
    >
      {/* Recruiting ribbon */}
      {trial.status === 'recruiting' && (
        <div className="recruiting-ribbon">RECRUITING</div>
      )}

      <div className={`transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Title area - fixed height */}
        <div style={{ height: '58px', overflow: 'hidden' }}>
          <div className="text-xl font-bold tracking-tight leading-[1.4] line-clamp-2">
            {title}
          </div>
        </div>

        {/* Description area - fixed height */}
        <div style={{ height: '44px', overflow: 'hidden', marginTop: '4px' }}>
          <div className="text-sm text-[#666] font-normal leading-relaxed line-clamp-2">
            {desc}
          </div>
        </div>
      </div>

      {/* Link - positioned at bottom */}
      <div className="absolute bottom-7 left-7">
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
