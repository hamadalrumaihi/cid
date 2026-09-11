// urlPolicy — static URL admission policy for external-source fetching.
//
// Pure TypeScript: no Deno, Node or browser-only APIs beyond the WHATWG `URL`
// global, so the SAME file is used verbatim by
//   supabase/functions/_shared/urlPolicy.ts   (jobs-runner edge function)
//   src/lib/urlPolicy.ts                      (client mirror + vitest ssrf suite)
//   workers/src/urlPolicy.ts                  (BullMQ worker)
// A test asserts the three copies are byte-identical — edit all three together.
//
// It mirrors `private.url_static_check(p_url)` in Postgres (contract §2.6):
// scheme http/https only, no userinfo, length <= 2048, no local/internal
// host names, no IP literals in private / loopback / link-local / CGNAT /
// metadata ranges, crawler_policy block/allow suffix matching. DNS resolution
// and per-redirect re-validation are the caller's job (runner/worker) — they
// use `isBlockedAddress` on every resolved address of every hop.

export interface UrlPolicyInput {
  allow_domains?: readonly string[] | null;
  block_domains?: readonly string[] | null;
}

export type UrlCheckCode =
  | 'ok'
  | 'bad_url'
  | 'too_long'
  | 'scheme'
  | 'userinfo'
  | 'host_blocked'
  | 'ip_blocked'
  | 'domain_blocked'
  | 'domain_not_allowed';

export interface UrlCheckResult {
  ok: boolean;
  code: UrlCheckCode;
  message: string;
  host: string | null;
  /** Normalised URL (lower-case host, default port dropped, fragment removed) or null when refused. */
  canonical: string | null;
}

export const URL_MAX_LENGTH = 2048;

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.arpa', '.corp'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);

function fail(code: UrlCheckCode, message: string, host: string | null = null): UrlCheckResult {
  return { ok: false, code, message, host, canonical: null };
}

/** Parse a dotted-quad IPv4 literal into its four octets, or null. Rejects shorthand/octal/hex forms. */
export function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((n) => n > 255)) return null;
  if (m.slice(1).some((p) => p.length > 1 && p.startsWith('0'))) return null;
  return parts;
}

/**
 * Expand an IPv6 literal into eight 16-bit groups, or null when it is not a
 * valid IPv6 address. Handles `::` compression, an embedded dotted IPv4 tail
 * (`::ffff:10.0.0.1`), surrounding brackets and a zone id (`fe80::1%eth0`).
 */
export function parseIPv6(input: string): number[] | null {
  let s = input.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':')) return null;
  // Embedded IPv4 tail → two hex groups.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    s = s.slice(0, lastColon + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = toGroups(halves[1]);
  if (!rest) return null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

function ipv4Blocked(o: number[]): boolean {
  const [a, b, c, d] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10 incl. 100.100.100.200 (Alibaba metadata)
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a >= 224) return true; // multicast + reserved + broadcast
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  return false;
}

/**
 * True when an IP address (v4 or v6 literal, as returned by a resolver) must
 * never be connected to: loopback, private, link-local, CGNAT, unspecified,
 * ULA, multicast, cloud metadata endpoints, and the IPv4-mapped /
 * IPv4-compatible / NAT64 IPv6 forms of all of those.
 */
export function isBlockedAddress(ip: string): boolean {
  const raw = (ip || '').trim();
  if (!raw) return true;
  const v4 = parseIPv4(raw);
  if (v4) return ipv4Blocked(v4);
  const v6 = parseIPv6(raw);
  if (!v6) return true; // unparseable → refuse
  const allZero = (from: number, to: number) => v6.slice(from, to).every((g) => g === 0);
  const tailV4 = () => [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff];
  // :: (unspecified) and ::1 (loopback)
  if (allZero(0, 7) && (v6[7] === 0 || v6[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (allZero(0, 5) && (v6[5] === 0xffff || v6[5] === 0)) return ipv4Blocked(tailV4());
  // SIIT ::ffff:0:a.b.c.d
  if (allZero(0, 4) && v6[4] === 0xffff && v6[5] === 0) return ipv4Blocked(tailV4());
  // NAT64 well-known prefix 64:ff9b::/96
  if (v6[0] === 0x64 && v6[1] === 0xff9b && allZero(2, 6)) return ipv4Blocked(tailV4());
  const top = v6[0];
  if ((top & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((top & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((top & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if ((top & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (top === 0x2001 && v6[1] === 0xdb8) return true; // documentation
  if (top === 0x2001 && v6[1] === 0) return true; // Teredo 2001::/32 (tunnels to arbitrary v4)
  if (top === 0x2002) return ipv4Blocked([v6[1] >> 8, v6[1] & 0xff, v6[2] >> 8, v6[2] & 0xff]); // 6to4
  return false;
}

function hostIsIpLiteral(host: string): 'v4' | 'v6' | null {
  if (host.startsWith('[') || host.includes(':')) return 'v6';
  if (/^\d+(\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return 'v4';
  return null;
}

function domainMatches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase().replace(/^\*?\./, '').replace(/\.$/, '');
  if (!p) return false;
  return host === p || host.endsWith('.' + p);
}

/**
 * Static admission check for a URL an analyst submitted. Never resolves DNS
 * and never touches the network; the runner/worker do those with
 * `isBlockedAddress` per hop.
 */
export function urlStaticCheck(url: string, policy: UrlPolicyInput | null | undefined): UrlCheckResult {
  const text = (url ?? '').trim();
  if (!text) return fail('bad_url', 'URL is empty.');
  if (text.length > URL_MAX_LENGTH) return fail('too_long', `URL exceeds ${URL_MAX_LENGTH} characters.`);
  if (/[\x00-\x1f\x7f\s]/.test(text)) return fail('bad_url', 'URL contains control or whitespace characters.');
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text);
  if (!schemeMatch) return fail('scheme', 'URL must start with http:// or https://.');
  const scheme = schemeMatch[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return fail('scheme', `Scheme "${scheme}:" is not allowed; only http and https.`);
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return fail('bad_url', 'URL could not be parsed.');
  }
  if (u.username || u.password) return fail('userinfo', 'URLs with embedded credentials are refused.', u.hostname || null);
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return fail('bad_url', 'URL has no host.');
  // WHATWG normalises `http://0x7f.1` → `127.0.0.1` and `http://2130706433` → dotted quad,
  // so the literal test below sees the canonical form.
  const literal = hostIsIpLiteral(host);
  if (literal) {
    const bare = host.replace(/^\[|\]$/g, '');
    if (isBlockedAddress(bare)) return fail('ip_blocked', 'IP address is in a private, loopback, link-local or metadata range.', host);
  } else {
    if (BLOCKED_HOSTS.has(host)) return fail('host_blocked', 'Local or metadata host names are refused.', host);
    if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return fail('host_blocked', 'Internal host names are refused.', host);
    if (!host.includes('.')) return fail('host_blocked', 'Single-label host names are refused.', host);
  }
  const block = (policy?.block_domains ?? []).filter(Boolean);
  if (block.some((d) => domainMatches(host, d))) return fail('domain_blocked', 'Domain is on the crawler block list.', host);
  const allow = (policy?.allow_domains ?? []).filter(Boolean);
  if (allow.length > 0 && !allow.some((d) => domainMatches(host, d))) {
    return fail('domain_not_allowed', 'Domain is not on the crawler allow list.', host);
  }
  u.hash = '';
  u.hostname = host;
  return { ok: true, code: 'ok', message: 'ok', host, canonical: u.toString() };
}
