// The wrapped command's environment (UC-2). Forward mode: the proxy, in both spellings programs read, and every standard runtime's
// CA setting pointed at the proxy's CA. Reverse mode: only FLOWS_PROXY_URL and the variables the caller names. Nothing else
// of the caller's environment changes, and nothing outside this one process.
type Env = Readonly<Record<string, string>>;

const PROXY_VARIABLES = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'] as const;
export const CA_VARIABLES = ['NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE', 'CURL_CA_BUNDLE', 'GIT_SSL_CAINFO'] as const;
const NAME = /^[A-Za-z_]\w*$/u;

export const forwardEnv = (base: Env, proxy: string, ca: string): Record<string, string> => ({
  ...base, ...Object.fromEntries(PROXY_VARIABLES.map((name) => [name, proxy])), ...Object.fromEntries(CA_VARIABLES.map((name) => [name, ca])), FLOWS_PROXY_URL: proxy,
});

export function reverseEnv(base: Env, proxy: string, names: readonly string[]): Record<string, string> {
  const bad = names.find((name) => !NAME.test(name));
  if (bad !== undefined) throw new Error(`--env ${bad} is not an environment variable name`);
  return { ...base, FLOWS_PROXY_URL: proxy, ...Object.fromEntries(names.map((name) => [name, proxy])) };
}
