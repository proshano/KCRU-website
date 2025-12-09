/**
 * Generate social media share URLs for a publication
 * @param {Object} publication - Publication object
 * @param {string} siteUrl - Base URL of the site (for linking back)
 * @returns {Object} Share URLs for each platform
 */
export function getShareUrls(publication, siteUrl = '') {
  const { title, pmid, doi, laySummary } = publication
  
  // URL to share (prefer DOI, fallback to PubMed)
  const articleUrl = doi 
    ? `https://doi.org/${doi}` 
    : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`

  // Text to share - use lay summary if available, otherwise title
  const shareText = laySummary 
    ? `${laySummary.slice(0, 200)}${laySummary.length > 200 ? '...' : ''}`
    : title

  const encodedUrl = encodeURIComponent(articleUrl)
  const encodedText = encodeURIComponent(shareText)
  const encodedTitle = encodeURIComponent(title)

  return {
    twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    
    // Optional: other platforms
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    
    email: `mailto:?subject=${encodedTitle}&body=${encodeURIComponent(`${shareText}\n\nRead more: ${articleUrl}`)}`
  }
}

/**
 * React component helper - returns share button data
 */
export function getShareButtons(publication, siteUrl = '') {
  const urls = getShareUrls(publication, siteUrl)
  
  return [
    {
      platform: 'twitter',
      label: 'Share on X',
      url: urls.twitter,
      icon: 'twitter', // or use lucide-react icon name
      ariaLabel: `Share "${publication.title}" on X (Twitter)`
    },
    {
      platform: 'linkedin',
      label: 'Share on LinkedIn',
      url: urls.linkedin,
      icon: 'linkedin',
      ariaLabel: `Share "${publication.title}" on LinkedIn`
    }
  ]
}

/**
 * SVG icons for share buttons (inline, no external dependencies)
 */
export const shareIcons = {
  twitter: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  
  bluesky: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489-.09-.79-.17-2.004.036-2.866.187-.78 1.209-5.126 1.209-5.126s-.309-.617-.309-1.529c0-1.432.83-2.502 1.863-2.502.879 0 1.303.659 1.303 1.449 0 .883-.562 2.202-.852 3.426-.242 1.024.514 1.859 1.525 1.859 1.83 0 3.235-1.929 3.235-4.712 0-2.465-1.772-4.187-4.303-4.187-2.932 0-4.653 2.199-4.653 4.471 0 .885.341 1.833.767 2.35.084.102.096.192.071.296l-.286 1.166c-.045.19-.149.23-.344.139-1.286-.598-2.09-2.477-2.09-3.985 0-3.246 2.36-6.23 6.8-6.23 3.571 0 6.345 2.544 6.345 5.944 0 3.546-2.236 6.402-5.341 6.402-1.043 0-2.023-.542-2.358-1.182l-.641 2.444c-.232.893-.858 2.012-1.276 2.695A10 10 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>`,
  
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`
}

