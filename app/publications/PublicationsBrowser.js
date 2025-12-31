'use client'

import { useState, useMemo, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getShareButtons, shareIcons } from '@/lib/sharing'
import { urlFor } from '@/lib/sanity'
import { findResearchersForPublication } from '@/lib/publicationUtils'

const DEFAULT_VISIBLE_TAGS = 5
const METHODS_VISIBLE_TAGS = 4

// Canonical category assignments - each tag belongs to exactly one category
const TOPIC_TAGS = new Set([
  'Perioperative and Surgery',
  'Hemodialysis',
  'Dialysis Vascular Access',
  'Peritoneal Dialysis',
  'Genetic Kidney Disease',
  'Kidney Transplantation',
  'Drug Safety',
  'Drug Dosing and Metabolism',
  'Acute Kidney Injury',
  'Glomerular Disease',
  'Diabetes and Metabolism',
  'Chronic Kidney Disease',
  'Obesity',
  'Hypertension',
  'Cardiovascular Disease',
  'Bone Health',
  'Kidney Disease in Cancer',
  'Health Systems',
  'Remote Monitoring and Care',
  'Clinical Decision Support',
  'Education',
  'Research Ethics',
])

const STUDY_DESIGN_TAGS = new Set([
  'Interventional Study',
  'Observational Study',
  'Systematic Evidence Synthesis',
  'Narrative Review',
  'Qualitative Study',
  'Case Report / Case Series',
  'Commentary / Editorial',
])

const METHODOLOGICAL_FOCUS_TAGS = new Set([
  'Pragmatic Trial',
  'Innovation in Study Design or Analysis',
  'Research Automation',
  'Health Economics',
  'Biomarker Development or Validation',
  'Diagnostic Accuracy',
  'Advanced Imaging',
  'Genomics / Genetic Testing',
  'Machine Learning / AI',
  'Administrative Data',
  'Survey Research',
  'Patient-Reported Outcomes',
  'Risk Estimation and Prognosis',
  'Preclinical',
])

/**
 * Normalize a publication's tags to their canonical categories
 */
function normalizePublicationTags(pub) {
  const allTags = [
    ...(pub.topics || []),
    ...(pub.studyDesign || []),
    ...(pub.methodologicalFocus || []),
  ]

  const cleanTopics = []
  const cleanStudyDesign = []
  const cleanMethodologicalFocus = []

  for (const tag of allTags) {
    if (TOPIC_TAGS.has(tag) && !cleanTopics.includes(tag)) {
      cleanTopics.push(tag)
    } else if (STUDY_DESIGN_TAGS.has(tag) && !cleanStudyDesign.includes(tag)) {
      cleanStudyDesign.push(tag)
    } else if (METHODOLOGICAL_FOCUS_TAGS.has(tag) && !cleanMethodologicalFocus.includes(tag)) {
      cleanMethodologicalFocus.push(tag)
    }
  }

  return {
    ...pub,
    topics: cleanTopics,
    studyDesign: cleanStudyDesign,
    methodologicalFocus: cleanMethodologicalFocus,
  }
}

export default function PublicationsBrowser({
  publications: rawPublications,
  researchers,
  provenance,
  altmetricEnabled,
  hideYearCounts = false,
}) {
  const [activeFilter, setActiveFilter] = useState(null) // { type: 'topic' | 'studyDesign' | 'methodologicalFocus', value: string }
  const [visibleCounts, setVisibleCounts] = useState({
    default: DEFAULT_VISIBLE_TAGS,
    methods: METHODS_VISIBLE_TAGS,
  })

  useEffect(() => {
    const computeVisible = () => {
      if (typeof window === 'undefined') return {
        default: DEFAULT_VISIBLE_TAGS,
        methods: METHODS_VISIBLE_TAGS,
      }
      const w = window.innerWidth
      const defaultCount = w >= 1280 ? 5 : w >= 900 ? 4 : 2
      const methodsCount = w >= 1280 ? 4 : w >= 900 ? 3 : 2
      return { default: defaultCount, methods: methodsCount }
    }
    setVisibleCounts(computeVisible())
    const handle = () => setVisibleCounts(computeVisible())
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])

  // Normalize tags to canonical categories (fixes LLM misclassifications)
  // and filter out excluded publications (corrections, errata, etc.)
  const publications = useMemo(
    () => rawPublications
      .map(normalizePublicationTags)
      .filter(pub => pub.exclude !== true),
    [rawPublications]
  )

  // Aggregate tag stats from all publications
  const tagStats = useMemo(() => aggregateTagStats(publications), [publications])

  // Filter publications based on active filter
  const filteredPublications = useMemo(() => {
    if (!activeFilter) return publications
    return publications.filter((pub) => {
      const { type, value } = activeFilter
      if (type === 'topic') return (pub.topics || []).includes(value)
      if (type === 'studyDesign') return (pub.studyDesign || []).includes(value)
      if (type === 'methodologicalFocus') return (pub.methodologicalFocus || []).includes(value)
      return true
    })
  }, [publications, activeFilter])

  // Build display from filtered publications
  const { byYear, years } = useMemo(() => {
    const pubs = [...filteredPublications].sort((a, b) => {
      const yearDiff = (b.year || 0) - (a.year || 0)
      if (yearDiff !== 0) return yearDiff
      const pmidA = parseInt(a.pmid, 10)
      const pmidB = parseInt(b.pmid, 10)
      if (!Number.isNaN(pmidA) && !Number.isNaN(pmidB)) {
        return pmidB - pmidA
      }
      return (a.title || '').localeCompare(b.title || '')
    })

    const byYear = pubs.reduce((acc, pub) => {
      const year = pub.year || 'Unknown'
      if (!acc[year]) acc[year] = []
      acc[year].push(pub)
      return acc
    }, {})

    return {
      byYear,
      years: Object.keys(byYear).sort((a, b) => b - a),
    }
  }, [filteredPublications])

  const handleTagClick = (type, value) => {
    if (activeFilter?.type === type && activeFilter?.value === value) {
      setActiveFilter(null) // Toggle off
    } else {
      setActiveFilter({ type, value })
    }
  }

  const clearFilter = () => setActiveFilter(null)

  return (
    <div className="space-y-8">
      <ResearchProfile
        tagStats={tagStats}
        activeFilter={activeFilter}
        onTagClick={handleTagClick}
        totalPublications={publications.length}
        visibleCounts={visibleCounts}
      />

      {activeFilter && (
        <div className="flex items-center gap-3 p-4 bg-purple/5 border border-purple/20 rounded-lg">
          <span className="text-sm text-[#1a1a1a]">
            Showing <strong className="text-purple">{filteredPublications.length}</strong> of {publications.length} publications with tag:
          </span>
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple text-white text-sm font-medium">
            {activeFilter.value}
            <button
              onClick={clearFilter}
              className="ml-1 hover:bg-white/20 rounded-full p-0.5 transition-colors"
              aria-label="Clear filter"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        </div>
      )}

      <YearSections
        years={years}
        byYear={byYear}
        researchers={researchers}
        provenance={provenance}
        altmetricEnabled={altmetricEnabled}
        onTagClick={handleTagClick}
        activeFilter={activeFilter}
        hideYearCounts={hideYearCounts}
      />
    </div>
  )
}

function aggregateTagStats(publications) {
  const topics = {}
  const studyDesign = {}
  const methodologicalFocus = {}

  for (const pub of publications) {
    for (const t of pub.topics || []) {
      topics[t] = (topics[t] || 0) + 1
    }
    for (const s of pub.studyDesign || []) {
      studyDesign[s] = (studyDesign[s] || 0) + 1
    }
    for (const m of pub.methodologicalFocus || []) {
      methodologicalFocus[m] = (methodologicalFocus[m] || 0) + 1
    }
  }

  const sortByCount = (obj) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))

  return {
    topics: sortByCount(topics),
    studyDesign: sortByCount(studyDesign),
    methodologicalFocus: sortByCount(methodologicalFocus),
    total: publications.length,
  }
}

function ResearchProfile({ tagStats, activeFilter, onTagClick, totalPublications, visibleCounts }) {
  const { topics, studyDesign, methodologicalFocus } = tagStats
  const hasAnyTags = topics.length > 0 || studyDesign.length > 0 || methodologicalFocus.length > 0

  const [expanded, setExpanded] = useState({
    topic: false,
    studyDesign: false,
    methodologicalFocus: false,
  })

  if (!hasAnyTags) return null

  const allCounts = [...topics, ...studyDesign, ...methodologicalFocus].map((t) => t.count)
  const maxCount = Math.max(...allCounts, 1)

  const renderTagSection = (items, label, typeKey) => {
    if (!items.length) return null

    const limit = typeKey === 'methodologicalFocus' ? visibleCounts.methods : visibleCounts.default
    const visibleItems = expanded[typeKey] ? items : items.slice(0, limit)
    const hasOverflow = items.length > limit
    const hiddenCount = Math.max(items.length - limit, 0)

    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-[#666] uppercase tracking-wide">{label}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {visibleItems.map(({ name, count }) => (
            <TagBar
              key={name}
              name={name}
              count={count}
              maxCount={maxCount}
              total={totalPublications}
              isActive={activeFilter?.type === typeKey && activeFilter?.value === name}
              onClick={() => onTagClick(typeKey, name)}
            />
          ))}
          {hasOverflow && (
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [typeKey]: !prev[typeKey] }))}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-purple/10 border border-purple/20 text-purple hover:bg-purple/20 transition-colors"
              title={expanded[typeKey] ? 'Show fewer tags' : 'Show all tags'}
              aria-label={expanded[typeKey] ? 'Collapse tags' : `Show ${hiddenCount} more tags`}
            >
              <span className="leading-none">
                {expanded[typeKey] ? 'Hide' : `+${hiddenCount}`}
              </span>
              <span className="text-base leading-none">{expanded[typeKey] ? '▲' : '▼'}</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="bg-white border border-black/[0.06] p-5 space-y-4">
      <h2 className="text-xl font-semibold text-[#1a1a1a]">Research Profile</h2>

      {renderTagSection(topics, 'Research Areas', 'topic')}
      {renderTagSection(studyDesign, 'Study Types', 'studyDesign')}
      {renderTagSection(methodologicalFocus, 'Methods & Approaches', 'methodologicalFocus')}
    </section>
  )
}

function TagBar({ name, count, maxCount, total, isActive, onClick }) {
  const ratio = count / maxCount
  const opacity = 0.4 + ratio * 0.6
  const rawPct = total > 0 ? (count / total) * 100 : 0
  const percentage = rawPct > 0 && rawPct < 1 ? 1 : Math.round(rawPct)

  return (
    <button
      onClick={onClick}
      className={`
        group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold 
        transition-colors cursor-pointer
        ${isActive 
          ? 'bg-purple text-white shadow-sm' 
          : 'text-purple hover:ring-2 hover:ring-purple/30'
        }
      `}
      style={isActive ? {} : { backgroundColor: `rgba(102, 51, 153, ${opacity * 0.15})` }}
      title={`${count} publications (${percentage}% of total) – Click to filter`}
    >
      <span>{name}</span>
      <span
        className={`text-xs px-2 py-0.5 rounded-full ${
          isActive ? 'bg-white/25 text-white' : 'bg-purple/20 text-purple/80'
        }`}
      >
        {`${percentage}%`}
      </span>
    </button>
  )
}

function YearSections({ years, byYear, researchers, provenance, altmetricEnabled, onTagClick, activeFilter, hideYearCounts }) {
  if (years.length === 0) {
    return (
      <p className="text-[#666] text-center py-8">No publications match the current filter.</p>
    )
  }

  return (
    <div className="space-y-2">
      {years.map((year, idx) => (
        <YearBlock
          key={year}
          year={year}
          pubs={byYear[year] || []}
          researchers={researchers}
          provenance={provenance}
          altmetricEnabled={altmetricEnabled}
          onTagClick={onTagClick}
          activeFilter={activeFilter}
          isLatestYear={idx === 0}
          hideYearCounts={hideYearCounts}
        />
      ))}
    </div>
  )
}

function YearBlock({ year, pubs, researchers, provenance, altmetricEnabled, onTagClick, activeFilter, isLatestYear, hideYearCounts }) {
  return (
    <section className="border border-black/[0.06] bg-white">
      <details className="group">
        <summary className="flex w-full cursor-pointer list-none items-center justify-between text-left px-6 py-4 hover:bg-[#fafafa] transition-colors">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold text-purple">{year}</span>
            {hideYearCounts ? (
              isLatestYear && (
                <span className="text-sm text-[#888] font-medium">click to view publications</span>
              )
            ) : (
              <span className="text-sm text-[#888] font-medium">{pubs.length} publications</span>
            )}
          </div>
          <span className="text-purple text-lg font-bold hidden group-open:inline" aria-hidden>
            −
          </span>
          <span className="text-purple text-lg font-bold group-open:hidden" aria-hidden>
            +
          </span>
        </summary>
        <div className="border-t border-black/[0.06] divide-y divide-black/[0.06]">
          {pubs.map((pub) => (
            <PublicationItem
              key={pub.pmid}
              pub={pub}
              researchers={researchers}
              provenance={provenance}
              altmetricEnabled={altmetricEnabled}
              onTagClick={onTagClick}
              activeFilter={activeFilter}
            />
          ))}
        </div>
      </details>
    </section>
  )
}

function PublicationItem({ pub, researchers, provenance, altmetricEnabled, onTagClick, activeFilter }) {
  const shareButtons = getShareButtons(pub)
  const matchedResearchers = findResearchersForPublication(pub, researchers, provenance)
  const hasAltmetricId = Boolean(pub?.doi || pub?.pmid)
  const showAltmetric = altmetricEnabled && hasAltmetricId

  return (
    <article className="p-6 space-y-3 bg-white border border-black/[0.05] shadow-sm rounded">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[240px] space-y-1">
          <h3 className="text-lg font-semibold leading-snug">
            <a
              href={pub.url || `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1a1a1a] hover:text-purple transition-colors"
            >
              {pub.title}
            </a>
          </h3>
          <p className="text-sm text-[#666]">{pub.authors?.join(', ')}</p>
          <p className="text-xs text-[#888] font-medium">
            {pub.journal} {pub.year && `· ${pub.year}`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {shareButtons.map((btn) => (
              <a
                key={btn.platform}
                href={btn.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.08] bg-white text-purple hover:bg-purple/5 transition-colors"
                aria-label={btn.ariaLabel}
              >
                {shareIcons[btn.icon] ? (
                  <span dangerouslySetInnerHTML={{ __html: shareIcons[btn.icon] }} />
                ) : (
                  <span>↗</span>
                )}
              </a>
            ))}
          </div>
          {showAltmetric && (
            <div
              className="altmetric-embed"
              data-badge-type="donut"
              data-badge-popover="right"
              data-link-target="_blank"
              data-doi={pub.doi || undefined}
              data-pmid={pub.doi ? undefined : pub.pmid}
            />
          )}
        </div>
      </div>
      {matchedResearchers.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {matchedResearchers.map((r) => (
            <Link
              key={r._id}
              href={r.slug?.current ? `/team/${r.slug.current}` : '#'}
              className="inline-flex items-center gap-2 border border-black/[0.08] px-3 py-1.5 hover:border-purple transition-colors"
            >
              <Avatar photo={r.photo} name={r.name} />
              <span className="text-purple font-medium">{r.name}</span>
            </Link>
          ))}
        </div>
      )}
      {pub.laySummary && (
        <p className="text-sm text-[#666] bg-[#F5F3F0] border border-black/[0.06] p-4 leading-relaxed">
          {pub.laySummary}
        </p>
      )}
      <ClassificationTags pub={pub} onTagClick={onTagClick} activeFilter={activeFilter} />
    </article>
  )
}

function ClassificationTags({ pub, onTagClick, activeFilter }) {
  const topics = pub.topics || []
  const studyDesign = pub.studyDesign || []
  const methodologicalFocus = pub.methodologicalFocus || []

  // Build tags with their type info for filtering
  const tagItems = [
    ...topics.map((t) => ({ name: t, type: 'topic' })),
    ...studyDesign.map((s) => ({ name: s, type: 'studyDesign' })),
    ...methodologicalFocus.map((m) => ({ name: m, type: 'methodologicalFocus' })),
  ]

  if (tagItems.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {tagItems.map((tag, idx) => {
        const isActive = activeFilter?.type === tag.type && activeFilter?.value === tag.name
        return (
          <button
            key={`tag-${idx}-${tag.name}`}
            onClick={() => onTagClick(tag.type, tag.name)}
            className={`
              inline-block px-2 py-0.5 rounded-full font-medium cursor-pointer
              transition-all hover:scale-105
              ${isActive 
                ? 'bg-purple text-white' 
                : 'bg-purple/10 text-purple hover:bg-purple/20'
              }
            `}
            title={`Filter by "${tag.name}"`}
          >
            {tag.name}
          </button>
        )
      })}
    </div>
  )
}

function Avatar({ photo, name }) {
  if (photo) {
    const src = urlFor(photo).width(64).height(64).fit('crop').url()
    return (
      <Image
        src={src}
        alt={name}
        width={24}
        height={24}
        className="h-6 w-6 rounded-full object-cover"
      />
    )
  }
  return (
    <span className="h-6 w-6 rounded-full bg-[#E8E5E0] text-xs flex items-center justify-center text-[#888] font-semibold">
      {name?.slice(0, 1)?.toUpperCase() || '?'}
    </span>
  )
}
