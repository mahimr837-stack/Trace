export const WAYBACK_CDX_BASE = 'https://web.archive.org/cdx/search/cdx';
export const SERVER_ARCHIVE_ENDPOINT = '/api/osint/archive';

export interface ArchiveSnapshot {
  timestamp: string;
  formattedDate: string;
  originalUrl: string;
  snapshotUrl: string;
  statusCode: string;
  mimeType: string;
}

export interface ArchiveCheckResponse {
  url: string;
  snapshots: ArchiveSnapshot[];
}

/**
 * Formats a 14-digit Wayback Machine timestamp (`YYYYMMDDHHmmss`) into a readable UTC string.
 */
export function formatWaybackTimestamp(timestamp: string): string {
  const clean = timestamp.trim();
  if (!/^\d{8,14}$/.test(clean)) return clean;
  const year = clean.slice(0, 4);
  const month = clean.slice(4, 6);
  const day = clean.slice(6, 8);
  if (clean.length < 12) {
    return `${year}-${month}-${day}`;
  }
  const hour = clean.slice(8, 10);
  const minute = clean.slice(10, 12);
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

/**
 * Builds the Wayback Machine CDX API query URL for the backend proxy.
 */
export function buildWaybackCdxUrl(targetUrl: string, limit = 20): string {
  const encoded = encodeURIComponent(targetUrl.trim());
  return `${WAYBACK_CDX_BASE}?url=${encoded}&output=json&limit=${limit}`;
}

/**
 * Extracts a candidate URL or domain from freeform text (such as OCR or Chat output).
 */
export function extractCandidateArchiveUrl(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  // 1. Explicit http(s) URL
  const httpMatch = trimmed.match(/https?:\/\/[^\s"'<>()]+/i);
  if (httpMatch) {
    return httpMatch[0].replace(/[.,;:!?)\]]+$/, '');
  }

  // 2. Bare domain or domain/path token (e.g. example.com or sub.example.org/path)
  const domainMatch = trimmed.match(
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s"'<>()]*)?/i,
  );
  if (domainMatch) {
    return domainMatch[0].replace(/[.,;:!?)\]]+$/, '');
  }

  return '';
}

/**
 * Parses the Wayback CDX JSON matrix (`[headerRow, ...dataRows]`) into clickable snapshot links.
 */
export function parseWaybackCdxResponse(payload: unknown): ArchiveSnapshot[] {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const headerRow = payload[0];
  if (!Array.isArray(headerRow)) return [];

  const colIndex = new Map<string, number>();
  headerRow.forEach((col, idx) => {
    if (typeof col === 'string') {
      colIndex.set(col.toLowerCase(), idx);
    }
  });

  const tsIdx = colIndex.get('timestamp') ?? 1;
  const origIdx = colIndex.get('original') ?? 2;
  const mimeIdx = colIndex.get('mimetype') ?? 3;
  const statusIdx = colIndex.get('statuscode') ?? 4;

  const snapshots: ArchiveSnapshot[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < payload.length; i++) {
    const row = payload[i];
    if (!Array.isArray(row)) continue;

    const timestamp = typeof row[tsIdx] === 'string' ? row[tsIdx].trim() : '';
    const originalUrl =
      typeof row[origIdx] === 'string' ? row[origIdx].trim() : '';
    if (!timestamp || !originalUrl) continue;

    const snapshotUrl = `https://web.archive.org/web/${timestamp}/${originalUrl}`;
    if (seen.has(snapshotUrl)) continue;
    seen.add(snapshotUrl);

    snapshots.push({
      timestamp,
      formattedDate: formatWaybackTimestamp(timestamp),
      originalUrl,
      snapshotUrl,
      statusCode: typeof row[statusIdx] === 'string' ? row[statusIdx] : '-',
      mimeType: typeof row[mimeIdx] === 'string' ? row[mimeIdx] : 'unknown',
    });
  }

  return snapshots;
}

/**
 * Calls the backend CORS proxy (`POST /api/osint/archive`) to query Wayback Machine snapshots.
 */
export async function runArchiveCheck(params: {
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<ArchiveCheckResponse> {
  const url = params.url.trim();
  if (!url) {
    throw new Error('Enter a URL or domain, or connect a Chat / OCR node.');
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);

  let response: Response;
  try {
    response = await fetchFn(SERVER_ARCHIVE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (isAbort) {
      throw new Error('Wayback Machine lookup timed out after 35s.');
    }
    throw new Error(
      error instanceof Error
        ? `Network error contacting archive proxy: ${error.message}`
        : 'Network error contacting archive proxy.',
    );
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => null)) as
    | (Partial<ArchiveCheckResponse> & { error?: unknown; message?: unknown })
    | null;

  if (!response.ok) {
    const errMsg =
      (payload && typeof payload.error === 'string' && payload.error.trim()) ||
      (payload && typeof payload.message === 'string' && payload.message.trim()) ||
      `Wayback archive lookup failed with HTTP ${response.status}.`;
    throw new Error(errMsg);
  }

  return {
    url: typeof payload?.url === 'string' ? payload.url : url,
    snapshots: Array.isArray(payload?.snapshots) ? payload.snapshots : [],
  };
}
