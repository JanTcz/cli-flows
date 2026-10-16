// UC-2 — the wrapped command's environment (docs/features/01-record.md): forward mode, the proxy and every standard runtime's CA
// setting; reverse mode, only FLOWS_PROXY_URL and the variables named; nothing else of the caller's environment changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CA_VARIABLES, forwardEnv, reverseEnv } from '../src/env.ts';

const PROXY = 'http://127.0.0.1:18123';
const CA = '/cache/conf/mitmproxy-ca-cert.pem';

test('UC-2: forward mode sets the proxy, both cases, and points every runtime at the proxy\'s CA', () => {
  const env = forwardEnv({ PATH: '/bin', HOME: '/h', HTTPS_PROXY: 'http://old:1' }, PROXY, CA);
  assert.deepEqual(CA_VARIABLES, ['NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE', 'CURL_CA_BUNDLE', 'GIT_SSL_CAINFO']);
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) assert.equal(env[name], PROXY, name);
  for (const name of CA_VARIABLES) assert.equal(env[name], CA, name);
  assert.equal(env['PATH'], '/bin');
  assert.equal(env['HOME'], '/h');
  assert.equal(env['FLOWS_PROXY_URL'], PROXY);
  assert.equal(Object.keys(env).length, 2 + 4 + CA_VARIABLES.length + 1, 'nothing else added');
});

test('UC-2: reverse mode sets FLOWS_PROXY_URL and each variable named, and touches no proxy or CA setting', () => {
  const env = reverseEnv({ PATH: '/bin', HTTPS_PROXY: 'http://corp:3128' }, PROXY, ['SERVICE_BASE_URL', 'OTHER_URL']);
  assert.deepEqual(env, { PATH: '/bin', HTTPS_PROXY: 'http://corp:3128', FLOWS_PROXY_URL: PROXY, SERVICE_BASE_URL: PROXY, OTHER_URL: PROXY });
  assert.deepEqual(reverseEnv({}, PROXY, []), { FLOWS_PROXY_URL: PROXY });
});

test('UC-2: a variable name that is not one is refused by name', () => {
  assert.throws(() => reverseEnv({}, PROXY, ['lower-case!']), /--env lower-case! is not an environment variable name/u);
});
