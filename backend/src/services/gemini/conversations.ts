import { randomUUID } from 'node:crypto';
import { type Data, records, string } from '../validation.js';
import { AppError } from '../../runtime/errors.js';

export interface Conversation {
  id: string; used: number; revision: number; turns: Data[];
  pending: (Data & { expires: number; task: string }) | null;
}
/** References only: no persisted transcript, evidence body, credentials, or timer. */
export class Conversations {
  private sessions = new Map<string, Conversation>();
  constructor(private clock = Date.now) {}
  open(id?: string): Conversation {
    const now = this.clock();
    for (const [key, value] of this.sessions) if (now - value.used >= 30 * 60000) this.sessions.delete(key);
    let session = id ? this.sessions.get(id) : undefined;
    if (!session) {
      if (this.sessions.size >= 1000) this.sessions.delete(this.sessions.keys().next().value!);
      session = { id: randomUUID(), used: now, revision: 0, turns: [], pending: null };
      this.sessions.set(session.id, session);
    }
    session.used = now;
    if (session.pending && session.pending.expires <= now) session.pending = null;
    return session;
  }
  pending(session: Conversation): Data | null {
    const value = session.pending;
    return value && value.expires > this.clock() ? { id: value.id, question: value.question, choices: value.choices, actions: value.actions } : null;
  }
  commit(session: Conversation, revision: number, turnId: string, references: Data[], scope: Data, pending: Data | null, task: string): void {
    if (session.revision !== revision) throw new AppError('CONVERSATION_CHANGED', 'A newer question changed this conversation. Ask again.', 409, true);
    session.turns = [...session.turns.filter(turn => turn.turn_id !== turnId), { turn_id: turnId, references, research_scope: scope }].slice(-6);
    session.pending = pending ? { ...pending, expires: this.clock() + 10 * 60000, task } : null;
    session.revision++; session.used = this.clock();
  }
}
export function conversationReferences(session: Conversation): Data[] {
  return session.turns.flatMap(turn => records(turn.references)).slice(-20);
}
/** Authorization evidence must be from the user, outside quoted/retrieved text.
 * Meaning is decided by the model; this guard rejects negation and quoted code,
 * without imposing an English command-verb vocabulary. */
export function actionQuote(message: string, quote: string): boolean {
  if (!quote.trim() || quote !== quote.trim()) return false;
  const at = message.indexOf(quote);
  if (at < 0 || message.indexOf(quote, at + 1) !== -1) return false;
  const masked = message.replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”|'[^'\n]*'/g, match => ' '.repeat(match.length));
  if (masked.slice(at, at + quote.length) !== quote) return false;
  const sentence = masked.slice(0, at).split(/[.;!?\n]/).at(-1)! + ' ' + quote;
  if (/^(?:no|nope|cancel|stop)[.!\s]*$/i.test(quote)) return false;
  return !/\b(?:not|never|don't|dont|cannot|can't|without|avoid|if|said|says|example)\b/i.test(sentence);
}
