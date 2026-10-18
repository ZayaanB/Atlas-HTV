import { AppError } from '../../runtime/errors.js';
import { type Data, object, records, string, strings } from '../validation.js';

export const filterKeys = ['location_ids', 'bounds', 'themes', 'entity_ids', 'event_types', 'topics', 'verification_status', 'has_location', 'keyword', 'semantic_query', 'published_from', 'published_to'] as const;
const geography = ['location_ids', 'bounds'];
const publication = ['published_from', 'published_to'];

// The intent model must point to an actual unquoted command in this message.
// This conservative English command gate is deliberately narrower than general
// language understanding: uncertain authorization permits only read-only research.
export function explicitCommand(message: string, quote: string, action: string): boolean {
  if (!quote.trim() || quote !== quote.trim()) return false;
  const at = message.indexOf(quote);
  if (at < 0 || message.indexOf(quote, at + 1) >= 0) return false;
  const masked = message.replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”|'[^'\n]*'/g, match => ' '.repeat(match.length));
  if (masked.slice(at, at + quote.length) !== quote) return false;
  const sentence = masked.slice(0, at).split(/[.;!?\n]/).at(-1)!;
  if (/\b(?:not|never|don't|dont|cannot|can't|without|avoid|if|said|saying|means?|explain|describe|whether|how|why|example)\b/i.test(sentence + ' ' + quote)) return false;
  const command = quote.replace(/^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?/i, '');
  if (action === 'set_filters' && /^(?:find|search|show)\b/i.test(command) && /\b(?:articles?|stories|story|reporting)\b/i.test(command) && !/\bfilters?\b/i.test(command)) return false;
  if (action === 'set_filters') return /^(?:show|find|search|filter|switch|change|set|clear|remove|reset|use)\b/i.test(command);
  if (action === 'focus_location') return /^(?:zoom|focus|fly|pan|center|centre|take me)\b/i.test(command);
  return action === 'open_timeline' && /^(?:show|open|display)\b/i.test(command) && /\b(?:timeline|chart|history)\b/i.test(command);
}

// Service policy, not a replacement wire schema. Callers first validate the
// intent and request with the authoritative shared v2 schemas.
export function permissions(input: Data, intent: Data) {
  const requested = records(intent.actions);
  const invalid = requested.some(a => !explicitCommand(string(input.message), string(a.quote), string(a.type)));
  const allowed = new Set(input.interaction_mode === 'read_only' || invalid || intent.clarification_reason
    ? [] : requested.map(a => string(a.type)));
  return { allowed, ambiguous: invalid, keys: new Set(strings(intent.filter_keys)), clear: new Set(strings(intent.clear_filters)) };
}

export function mergeFilterPatch(current: Data, raw: Data, authorized: Set<string>, clearable: Set<string>): Data {
  const set = object(raw.set), clear = strings(raw.clear);
  const changed = [...Object.keys(set), ...clear];
  if (changed.some(key => !filterKeys.includes(key as typeof filterKeys[number]) || !authorized.has(key)))
    throw new AppError('ACTION_NOT_AUTHORIZED', 'The request did not authorize this filter change', 502);
  if (clear.some(key => !clearable.has(key)) || clear.some(key => Object.hasOwn(set, key)))
    throw new AppError('ACTION_NOT_AUTHORIZED', 'Clearing a filter requires an explicit instruction', 502);
  if (Object.entries(set).some(([, value]) => value === null || value === undefined || (Array.isArray(value) && !value.length) || (typeof value === 'string' && !value.trim())))
    throw new AppError('INVALID_INPUT', 'Use explicit clear operations for empty filters');
  const next = { ...current };
  if (Object.keys(set).some(key => geography.includes(key))) geography.forEach(key => delete next[key]);
  if (Object.keys(set).some(key => publication.includes(key))) publication.forEach(key => delete next[key]);
  clear.forEach(key => delete next[key]);
  return { ...next, ...set, offset: 0 };
}

export function clarification(reason: string): string {
  const messages: Record<string, string> = {
    ambiguous_intent: 'Which topic or place would you like to explore?',
    missing_location: 'Which place should I use? Select a location or explicitly choose a map area.',
    ambiguous_location: 'Which of the available locations did you mean?',
    missing_metric: 'Which available observation metric would you like to compare?',
    unsupported_period: 'Which period should I use? Specify calendar dates, today, yesterday, this or last week/month, or past N days.',
    unsupported_coverage: 'That request is outside the available coverage. Choose a supported place, topic, or observation series.'
  };
  if (!Object.hasOwn(messages, reason)) throw new AppError('INVALID_MODEL_OUTPUT', 'Unsupported clarification reason', 502);
  return messages[reason]!;
}
