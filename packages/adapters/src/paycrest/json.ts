/**
 * JSON without floating-point numbers.
 *
 * Paycrest's API is written against decimal types and sends amounts and rates
 * as JSON numbers — `0.5`, `1580.25`. `JSON.parse` turns those into IEEE-754
 * doubles before any code of ours sees them, and from that point the exact
 * value the provider meant is a guess (guardrail 12: no floating-point money
 * crosses an adapter boundary).
 *
 * So every numeric literal is quoted *before* parsing and arrives as the exact
 * text the provider sent. Callers then parse those strings into integer minor
 * units, or reject them. Nothing outside this file ever sees a JSON number.
 */
export function parseJsonExact(text: string): unknown {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < text.length && /[0-9eE+\-.]/.test(text[j]!)) j++;
      out += `"${text.slice(i, j)}"`;
      i = j - 1;
      continue;
    }

    out += ch;
  }

  return JSON.parse(out) as unknown;
}
