// Redaction before a record touches the disk (UC-3): secret headers by name, token shapes anywhere in a body, the values of JSON
// fields named like a secret; nothing else changes. A body is kept up to BODY_LIMIT, the cut said.
export const BODY_LIMIT = 64 * 1024;
const REDACTED = '<redacted>';
const SECRET_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie']);
const SECRET_HEADER_NAME = /key|token|secret|password/iu;
const SECRET_FIELD = /(?:api[_-]?key|secret|password|token)$/iu;
const TOKENS: readonly [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gu, `$1 ${REDACTED}`],
  [/\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/gu, REDACTED],
  [/\bsk-[\w-]{16,}/gu, REDACTED],
  [/\bghp_[A-Za-z0-9]{30,}/gu, REDACTED],
  [/\bgithub_pat_\w{20,}/gu, REDACTED],
  [/\bxox[abpr]-[\w-]{10,}/gu, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/gu, REDACTED],
];

export type Header = [string, string];

export const redactHeaders = (headers: readonly Header[]): Header[] =>
  headers.map(([name, value]) => [name, SECRET_HEADERS.has(name.toLowerCase()) || SECRET_HEADER_NAME.test(name) ? REDACTED : value]);

function redactFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactFields(item));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, SECRET_FIELD.test(key) && (typeof item === 'string' || typeof item === 'number') ? REDACTED : redactFields(item)]));
}

function fieldsRedacted(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? JSON.stringify(redactFields(parsed)) : text;
  } catch {
    return text;
  }
}

export function redactBody(text: string): { text: string; cut: boolean } {
  const redacted = TOKENS.reduce((said, [shape, by]) => said.replace(shape, by), fieldsRedacted(text));
  return redacted.length > BODY_LIMIT ? { text: redacted.slice(0, BODY_LIMIT), cut: true } : { text: redacted, cut: false };
}
