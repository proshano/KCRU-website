'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { urlFor } from '@/lib/sanity'

export default function FeaturedStudy({ trials = [] }) {
  const router = useRouter()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)
  const [isHovered, setIsHovered] = useState(false)

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
  // Prefer internal study page when slug is available
  const slugValue = trial.slug?.current || trial.slug
  const href = slugValue ? `/trials/${slugValue}` : '/trials'
  const title = trial.title || 'Study'
  const pi = trial.principalInvestigator
  const piName = pi?.name || trial.principalInvestigatorName
  const piPhoto = pi?.photo

  const handleClick = () => {
    router.push(href)
  }

  return (
    <div 
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="block mt-8 p-7 bg-gradient-to-br from-[#F5F3F0] to-[#EEEBE6] relative overflow-hidden cursor-pointer transition-all"
      style={{ 
        height: '250px', 
        minHeight: '250px', 
        maxHeight: '250px', 
        flexShrink: 0, 
        touchAction: 'manipulation',
        border: isHovered ? '1.5px solid #5B21B6' : '1.5px solid transparent'
      }}
    >
      {/* Recruiting ribbon */}
      {trial.status === 'recruiting' && (
        <div className="recruiting-ribbon pointer-events-none">RECRUITING</div>
      )}

      <div className={`pointer-events-none transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Title area - fixed height */}
        <div style={{ height: '150px', overflow: 'hidden' }}>
          <div className="text-xl font-bold tracking-tight leading-[1.4] line-clamp-4">
            {title}
          </div>
        </div>

        {/* Bottom row: Investigator chip + Learn more */}
        <div className="mt-4 flex items-center gap-4">
          {/* Investigator chip */}
          {piName && (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-purple bg-white/60 px-3 py-1.5 rounded-full border border-black/[0.06]">
              <Avatar photo={piPhoto} name={piName} />
              {piName}
            </span>
          )}

          {/* Learn more link */}
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-purple">
            Learn more
            <span>→</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function Avatar({ photo, name }) {
  if (photo) {
    const src = urlFor(photo).width(48).height(48).fit('crop').url()
    return (
      <Image
        src={src}
        alt={name || ''}
        width={20}
        height={20}
        className="h-5 w-5 rounded-full object-cover"
      />
    )
  }
  return (
    <span className="h-5 w-5 rounded-full bg-[#E8E5E0] text-[10px] flex items-center justify-center text-[#888] font-semibold">
      {name?.slice(0, 1)?.toUpperCase() || '?'}
    </span>
  )
}
