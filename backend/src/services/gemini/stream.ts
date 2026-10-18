import { AppError } from '../../runtime/errors.js';

// Read only a top-level string from partial JSON. Incomplete escapes and Unicode
// pairs stay buffered; nested evidence, thought text and tool arguments never
// become answer text. The complete object still undergoes shared validation.
export function partialStringProperty(json: string, property: string): string | undefined {
  const whitespace = () => { while (/\s/.test(json[position] ?? '') && position < json.length) position++; };
  let position = 0;
  function quoted(): { value: string; complete: boolean } {
    if (json[position++] !== '"') throw new AppError('INVALID_MODEL_OUTPUT', 'Invalid structured response', 502);
    let value = '';
    while (position < json.length) {
      const char = json[position++]!;
      if (char === '"') return { value, complete: true };
      if (char !== '\\') { value += char; continue; }
      if (position === json.length) break;
      const escape = json[position++]!;
      if (escape === 'u') {
        if (json.length - position < 4) break;
        const hex = json.slice(position, position + 4);
        if (!/^[\da-f]{4}$/i.test(hex)) throw new AppError('INVALID_MODEL_OUTPUT', 'Invalid structured response', 502);
        value += String.fromCharCode(parseInt(hex, 16)); position += 4;
      } else {
        const escaped: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (!(escape in escaped)) throw new AppError('INVALID_MODEL_OUTPUT', 'Invalid structured response', 502);
        value += escaped[escape];
      }
    }
    return { value: value.replace(/[\uD800-\uDBFF]$/, ''), complete: false };
  }
  whitespace(); if (json[position++] !== '{') return;
  while (position < json.length) {
    whitespace(); if (json[position] !== '"') return;
    const key = quoted(); if (!key.complete) return;
    whitespace(); if (json[position++] !== ':') return;
    whitespace();
    if (key.value === property) return json[position] === '"' ? quoted().value : undefined;
    // Skip an arbitrary other value without mistaking nested/string commas for
    // the next top-level key. Incomplete values simply await the next chunk.
    let depth = 0, ended = false;
    while (position < json.length) {
      const char = json[position];
      if (char === '"') { if (!quoted().complete) return; continue; }
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') { if (!depth) return; depth--; }
      if (char === ',' && !depth) { position++; ended = true; break; }
      position++;
    }
    if (!ended) return;
  }
}
