import {
  getGlobalShodanApiKey,
  MISSING_SHODAN_KEY_MESSAGE,
} from './globalSettings';

export const SHODAN_API_BASE = 'https://api.shodan.io';
export const SERVER_SHODAN_ENDPOINT = '/api/osint/shodan';

export interface ShodanHostResult {
  ip: string;
  port: number;
  org: string;
  hostnames: string[];
  product?: string | null;
  os?: string | null;
  location?: string | null;
  screenshotDataUrl?: string | null;
}

export interface ShodanSearchResponse {
  query: string;
  mode: 'host' | 'search';
  total: number;
  results: ShodanHostResult[];
}

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|1?\d\d?)$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,39}$/;

/**
 * Returns true if the query is a standalone IPv4 or IPv6 address.
 */
export function isIpAddress(query: string): boolean {
  const trimmed = query.trim();
  if (IPV4_RE.test(trimmed)) return true;
  if (trimmed.includes(':') && IPV6_RE.test(trimmed)) return true;
  return false;
}

/**
 * Builds the upstream Shodan REST API URL for either a single IP lookup
 * (`/shodan/host/{ip}`) or a general host search (`/shodan/host/search`).
 */
export function buildShodanUpstreamUrl(query: string, apiKey: string): {
  url: string;
  mode: 'host' | 'search';
} {
  const trimmedQuery = query.trim();
  const encodedKey = encodeURIComponent(apiKey.trim());
  if (isIpAddress(trimmedQuery)) {
    return {
      mode: 'host',
      url: `${SHODAN_API_BASE}/shodan/host/${encodeURIComponent(trimmedQuery)}?key=${encodedKey}`,
    };
  }
  return {
    mode: 'search',
    url: `${SHODAN_API_BASE}/shodan/host/search?key=${encodedKey}&query=${encodeURIComponent(trimmedQuery)}`,
  };
}

function extractScreenshotDataUrl(record: Record<string, unknown>): string | null {
  const opts = record.opts;
  if (!opts || typeof opts !== 'object') return null;
  const screenshot = (opts as Record<string, unknown>).screenshot;
  if (!screenshot || typeof screenshot !== 'object') return null;
  const data = (screenshot as Record<string, unknown>).data;
  if (typeof data !== 'string' || !data.trim()) return null;
  const rawData = data.trim();
  if (rawData.startsWith('data:image/')) return rawData;
  const mimeRaw = (screenshot as Record<string, unknown>).mime;
  const mime =
    typeof mimeRaw === 'string' && mimeRaw.startsWith('image/')
      ? mimeRaw
      : 'image/jpeg';
  return `data:${mime};base64,${rawData}`;
}

function formatShodanLocation(loc: unknown): string | null {
  if (!loc || typeof loc !== 'object') return null;
  const rec = loc as Record<string, unknown>;
  const parts = [rec.city, rec.country_name]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  return parts.length > 0 ? parts.join(', ') : null;
}

function parseSingleMatch(
  item: Record<string, unknown>,
  fallbackIp: string,
  fallbackOrg: string,
  fallbackHostnames: string[],
): ShodanHostResult | null {
  const ip =
    (typeof item.ip_str === 'string' && item.ip_str.trim()) ||
    fallbackIp.trim();
  if (!ip) return null;

  const port = typeof item.port === 'number' && Number.isFinite(item.port) ? item.port : 0;
  const org =
    (typeof item.org === 'string' && item.org.trim()) ||
    (typeof item.isp === 'string' && item.isp.trim()) ||
    fallbackOrg.trim() ||
    'Unknown Organization';

  const hostnames = Array.isArray(item.hostnames)
    ? item.hostnames.filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    : fallbackHostnames;

  const product =
    typeof item.product === 'string' && item.product.trim()
      ? item.product.trim()
      : null;
  const os =
    typeof item.os === 'string' && item.os.trim() ? item.os.trim() : null;

  return {
    ip,
    port,
    org,
    hostnames,
    product,
    os,
    location: formatShodanLocation(item.location),
    screenshotDataUrl: extractScreenshotDataUrl(item),
  };
}

/**
 * Normalizes both Shodan `/shodan/host/search` (`matches[]`) and
 * `/shodan/host/{ip}` (`data[]`) payloads into a uniform host list.
 */
export function normalizeShodanResponse(
  payload: unknown,
  mode: 'host' | 'search',
): { total: number; results: ShodanHostResult[] } {
  if (!payload || typeof payload !== 'object') {
    return { total: 0, results: [] };
  }
  const rec = payload as Record<string, unknown>;

  if (Array.isArray(rec.matches)) {
    const results: ShodanHostResult[] = [];
    for (const rawItem of rec.matches) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const parsed = parseSingleMatch(
        rawItem as Record<string, unknown>,
        '',
        '',
        [],
      );
      if (parsed) results.push(parsed);
    }
    const total =
      typeof rec.total === 'number' && Number.isFinite(rec.total)
        ? rec.total
        : results.length;
    return { total, results };
  }

  // Direct IP host lookup response (`/shodan/host/{ip}`)
  const rootIp = typeof rec.ip_str === 'string' ? rec.ip_str.trim() : '';
  const rootOrg =
    (typeof rec.org === 'string' && rec.org.trim()) ||
    (typeof rec.isp === 'string' && rec.isp.trim()) ||
    'Unknown Organization';
  const rootHostnames = Array.isArray(rec.hostnames)
    ? rec.hostnames.filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    : [];

  if (Array.isArray(rec.data)) {
    const results: ShodanHostResult[] = [];
    for (const rawService of rec.data) {
      if (!rawService || typeof rawService !== 'object') continue;
      const parsed = parseSingleMatch(
        rawService as Record<string, unknown>,
        rootIp,
        rootOrg,
        rootHostnames,
      );
      if (parsed) results.push(parsed);
    }
    return { total: results.length, results };
  }

  if (mode === 'host' && rootIp) {
    const ports = Array.isArray(rec.ports)
      ? rec.ports.filter((p): p is number => typeof p === 'number')
      : [0];
    const results: ShodanHostResult[] = ports.map((port) => ({
      ip: rootIp,
      port,
      org: rootOrg,
      hostnames: rootHostnames,
      product: null,
      os: typeof rec.os === 'string' ? rec.os : null,
      location: formatShodanLocation(rec),
      screenshotDataUrl: null,
    }));
    return { total: results.length, results };
  }

  return { total: 0, results: [] };
}

/**
 * Calls the backend CORS proxy (`POST /api/osint/shodan`) using the provided
 * or globally stored Shodan API key.
 */
export async function runShodanSearch(params: {
  query: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<ShodanSearchResponse> {
  const query = params.query.trim();
  if (!query) {
    throw new Error('Enter an IP address or Shodan search query first.');
  }

  const apiKey = params.apiKey?.trim() || getGlobalShodanApiKey();
  if (!apiKey) {
    throw new Error(MISSING_SHODAN_KEY_MESSAGE);
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  let response: Response;
  try {
    response = await fetchFn(SERVER_SHODAN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, apiKey }),
      signal: controller.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (isAbort) {
      throw new Error('Shodan lookup timed out after 20s.');
    }
    throw new Error(
      error instanceof Error
        ? `Network error contacting Shodan proxy: ${error.message}`
        : 'Network error contacting Shodan proxy.',
    );
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => null)) as
    | (Partial<ShodanSearchResponse> & { error?: unknown; message?: unknown })
    | null;

  if (!response.ok) {
    const errMsg =
      (payload && typeof payload.error === 'string' && payload.error.trim()) ||
      (payload && typeof payload.message === 'string' && payload.message.trim()) ||
      `Shodan lookup failed with HTTP ${response.status}.`;
    throw new Error(errMsg);
  }

  return {
    query: typeof payload?.query === 'string' ? payload.query : query,
    mode: payload?.mode === 'host' ? 'host' : 'search',
    total: typeof payload?.total === 'number' ? payload.total : 0,
    results: Array.isArray(payload?.results) ? payload.results : [],
  };
}
