import { classifyPublicationWithJev, resolveJevThresholds } from './jevClassifier.js'
import { classifyPublication } from './summaries.js'

/**
 * One entry point for "classify this publication", dispatching on the configured backend.
 *
 * Returns the usual `{ topics, studyDesign, methodologicalFocus, exclude }` plus `backend`
 * (which system actually produced the tags), `provider` and `model` for the Jev path so the
 * stored classification records what classified it, and `probabilities` when Jev ran.
 *
 * Jev failures fall back to the chat model unless `fallbackToChat: false`. A refresh run by
 * staff should not lose a paper's tags because a newer endpoint had a bad afternoon; the
 * fallback is logged and recorded on the result so it is visible afterwards.
 */
export async function classifyPublicationWithBackend(publication, options = {}) {
  const backend = options.backend === 'jev' ? 'jev' : 'chat'
  const chatClassify = options.chatClassify || classifyPublication
  const jevClassify = options.jevClassify || classifyPublicationWithJev

  if (backend === 'jev') {
    try {
      const jev = await jevClassify(publication, {
        classificationPrompt: options.classificationPrompt,
        thresholds: resolveJevThresholds(options.thresholds),
        model: options.jevModel,
        transport: options.jevTransport,
        apiKey: options.jevApiKey,
        fetch: options.fetch,
        debug: options.debug,
      })
      return {
        topics: jev.topics,
        studyDesign: jev.studyDesign,
        methodologicalFocus: jev.methodologicalFocus,
        exclude: jev.exclude,
        backend: 'jev',
        provider: jev.transport,
        model: jev.model,
        probabilities: jev.probabilities,
        thresholds: jev.thresholds,
      }
    } catch (error) {
      if (options.fallbackToChat === false) throw error
      console.warn('[classification] Jev failed; falling back to the chat model', {
        pmid: options.meta?.pmid || null,
        message: error?.message || String(error),
      })
      const chat = await chatClassify(publication, options)
      return { ...chat, backend: 'chat', fallbackFrom: 'jev', fallbackError: error?.message || String(error) }
    }
  }

  const chat = await chatClassify(publication, options)
  return { ...chat, backend: 'chat' }
}
