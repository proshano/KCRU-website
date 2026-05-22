export function applyPublicationClassificationOverlay(publication, classification) {
  if (!classification) return publication

  const overlaid = {
    ...publication,
    topics: Array.isArray(classification.topics) ? classification.topics : publication.topics || [],
    studyDesign: Array.isArray(classification.studyDesign) ? classification.studyDesign : publication.studyDesign || [],
    methodologicalFocus: Array.isArray(classification.methodologicalFocus)
      ? classification.methodologicalFocus
      : publication.methodologicalFocus || [],
  }

  if (typeof classification.exclude === 'boolean') {
    overlaid.exclude = classification.exclude
  } else if (Object.prototype.hasOwnProperty.call(publication, 'exclude')) {
    overlaid.exclude = publication.exclude
  }

  return overlaid
}
