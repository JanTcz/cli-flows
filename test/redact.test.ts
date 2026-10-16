// UC-3 — redaction before a record touches the disk (docs/features/01-record.md): secret headers, token shapes and secret JSON
// fields in bodies; nothing else changes; a body is kept up to 64 KiB, the cut said.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODY_LIMIT, redactBody, redactHeaders } from '../src/redact.ts';

test('UC-3: secret headers by name, and any header whose name says key, token, secret or password', () => {
  const headers: [string, string][] = [
    ['Authorization', 'Bearer abc'], ['proxy-authorization', 'Basic x'], ['Cookie', 'a=b'], ['Set-Cookie', 's=1'], ['X-Api-Key', 'k1'],
    ['X-Auth-Token', 't'], ['client-secret', 's'], ['X-Password', 'p'], ['Content-Type', 'application/json'], ['Accept', '*/*'], ['x-request-id', 'r1'],
  ];
  assert.deepEqual(redactHeaders(headers), [
    ['Authorization', '<redacted>'], ['proxy-authorization', '<redacted>'], ['Cookie', '<redacted>'], ['Set-Cookie', '<redacted>'], ['X-Api-Key', '<redacted>'],
    ['X-Auth-Token', '<redacted>'], ['client-secret', '<redacted>'], ['X-Password', '<redacted>'], ['Content-Type', 'application/json'], ['Accept', '*/*'], ['x-request-id', 'r1'],
  ]);
});

test('UC-3: token shapes in a body are redacted wherever they stand; the rest of the text stays', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
  const said = redactBody(`call with Bearer abc.DEF-123 and ${jwt}; keys sk-live-0123456789abcdefABCD ghp_0123456789abcdefghijABCDEFGHIJ012345 github_pat_11AAAAAAA0123456789_abc xoxb-123-456-abc AKIAIOSFODNN7EXAMPLE end`);
  assert.equal(said.text, 'call with Bearer <redacted> and <redacted>; keys <redacted> <redacted> <redacted> <redacted> <redacted> end');
  assert.equal(said.cut, false);
});

test('UC-3: the values of JSON fields named like a secret are redacted, other fields and the shape stay', () => {
  const body = JSON.stringify({ model: 'm', api_key: 'k', nested: { accessToken: 't', client_secret: 's', password: 'p', count: 3 }, tokens: 42, keys: ['a'] });
  assert.deepEqual(JSON.parse(redactBody(body).text), { model: 'm', api_key: '<redacted>', nested: { accessToken: '<redacted>', client_secret: '<redacted>', password: '<redacted>', count: 3 }, tokens: 42, keys: ['a'] });
});

test('UC-3: a body over 64 KiB is cut, and the cut is said', () => {
  assert.equal(BODY_LIMIT, 64 * 1024);
  const said = redactBody('a'.repeat(BODY_LIMIT + 10));
  assert.equal(said.text.length, BODY_LIMIT);
  assert.equal(said.cut, true);
  assert.deepEqual(redactBody(''), { text: '', cut: false });
});
