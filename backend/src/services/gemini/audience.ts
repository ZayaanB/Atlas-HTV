import {AppError} from '../../runtime/errors.js';

// Server-authored prompt policy, not an Article tag or a replacement shared schema.
// Person 1 must add the optional audience selector to the authoritative request contract.
const guidance = {
  general_public: 'Explain what happened in plain language, the sourced effects on people and services, useful verified resources, and what remains unknown.',
  journalist: 'Prioritize the source trail, distinct event/publication/observation times, confirmed facts, evidence gaps, and clearly labeled research questions. Do not turn a research lead into an allegation.',
  investor: 'Prioritize documented sector, infrastructure, supply-chain and company exposure only where retrieved evidence supports it. Distinguish exposure from demonstrated financial impact; do not infer company relationships or investment recommendations from proximity or headlines.'
};
export function audienceContext(value: unknown) {
  const audience=value===undefined?'general_public':value;
  if (typeof audience!=='string' || !Object.hasOwn(guidance,audience))
    throw new AppError('INVALID_AUDIENCE','Choose general_public, journalist, or investor');
  return {
    audience,
    guidance: guidance[audience as keyof typeof guidance],
    evidence_rule: 'Use the same retrieved facts, source citations and active filters for every audience. Perspective changes emphasis, never the underlying facts. Audience relevance is not a verified article tag.'
  };
}
