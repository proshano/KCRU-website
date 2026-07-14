export class SanityDocumentTypeError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.name = 'SanityDocumentTypeError'
    this.statusCode = statusCode
  }
}

export async function requireSanityDocumentType({ fetch, id, expectedType, label = 'Document' }) {
  const document = await fetch('*[_id == $id][0]{ _id, _type }', { id })

  if (!document?._id) {
    throw new SanityDocumentTypeError(`${label} not found.`, 404)
  }
  if (document._type !== expectedType) {
    throw new SanityDocumentTypeError(`${label} id does not reference a ${expectedType} document.`, 400)
  }
  return document
}
