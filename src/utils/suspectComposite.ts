import type { Edge } from 'reactflow';
import type { OsintNode } from '../types/osint';
import {
  ApiAuthError,
  getGlobalApiKey,
  MISSING_API_KEY_CODE,
  MISSING_API_KEY_MESSAGE,
  readGlobalSettings,
} from './globalSettings';
import type { LlmProviderId } from './llmProviders';
import { HANDLE_IDS, type ParsedInlineImage } from './osintGraph';

export const IMAGEN_MODEL_ID = 'imagen-3.0-generate-001';
export const DALLE_MODEL_ID = 'dall-e-3';
export const OPENAI_IMAGES_ENDPOINT =
  'https://api.openai.com/v1/images/generations';
export const SERVER_IMAGE_GENERATE_ENDPOINT = '/api/image/generate';

export interface SuspectContextItem {
  nodeId: string;
  title: string;
  sourceType: 'image' | 'ocr' | 'chat';
  summaryText: string;
  imageUrl?: string | null;
}

export interface ResolvedSuspectContext {
  items: SuspectContextItem[];
  imageUrls: Array<{ nodeId: string; title: string; imageUrl: string }>;
  summaryLabel: string;
  combinedContextText: string;
}

/**
 * Resolves all connected ImageNode, OcrNode, and ChatNode inputs feeding into a SuspectNode.
 */
export function resolveSuspectContextForNode(
  suspectNodeId: string,
  nodes: OsintNode[],
  edges: Edge[],
): ResolvedSuspectContext {
  const incomingEdges = edges.filter(
    (edge) =>
      edge.target === suspectNodeId &&
      (!edge.targetHandle || edge.targetHandle === HANDLE_IDS.SUSPECT_IN),
  );

  const items: SuspectContextItem[] = [];
  const imageUrls: Array<{ nodeId: string; title: string; imageUrl: string }> =
    [];
  const seenIds = new Set<string>();

  for (const edge of incomingEdges) {
    if (seenIds.has(edge.source)) continue;
    const sourceNode = nodes.find((node) => node.id === edge.source);
    if (!sourceNode) continue;

    if (sourceNode.data.kind === 'image') {
      seenIds.add(sourceNode.id);
      const title = sourceNode.data.title || 'Evidence Image';
      const labelPart = sourceNode.data.sourceLabel
        ? ` (${sourceNode.data.sourceLabel})`
        : '';
      const dimPart = sourceNode.data.dimensions
        ? ` [${sourceNode.data.dimensions}]`
        : '';
      const hasImg = Boolean(sourceNode.data.imageUrl);
      items.push({
        nodeId: sourceNode.id,
        title,
        sourceType: 'image',
        summaryText: hasImg
          ? `Reference Image Frame: "${title}"${labelPart}${dimPart}`
          : `Reference Image Frame: "${title}" (no image loaded)`,
        imageUrl: sourceNode.data.imageUrl,
      });
      if (sourceNode.data.imageUrl) {
        imageUrls.push({
          nodeId: sourceNode.id,
          title,
          imageUrl: sourceNode.data.imageUrl,
        });
      }
    } else if (sourceNode.data.kind === 'enhance') {
      seenIds.add(sourceNode.id);
      const title = sourceNode.data.title || 'Enhanced Image';
      const hasImg = Boolean(sourceNode.data.enhancedImageUrl);
      items.push({
        nodeId: sourceNode.id,
        title,
        sourceType: 'image',
        summaryText: hasImg
          ? `Enhanced Image Frame: "${title}" (${sourceNode.data.scale}x)`
          : `Enhanced Image Frame: "${title}" (no image loaded)`,
        imageUrl: sourceNode.data.enhancedImageUrl ?? null,
      });
      if (sourceNode.data.enhancedImageUrl) {
        imageUrls.push({
          nodeId: sourceNode.id,
          title,
          imageUrl: sourceNode.data.enhancedImageUrl,
        });
      }
    } else if (sourceNode.data.kind === 'ocr') {
      seenIds.add(sourceNode.id);
      const title = sourceNode.data.title || 'OCR Extractor';
      const text = (sourceNode.data.extractedText ?? '').trim();
      items.push({
        nodeId: sourceNode.id,
        title,
        sourceType: 'ocr',
        summaryText: text
          ? `OCR Extracted Text (${title}): ${text}`
          : `OCR Extracted Text (${title}): (empty)`,
      });
    } else if (sourceNode.data.kind === 'chat') {
      seenIds.add(sourceNode.id);
      const title = sourceNode.data.title || 'Chat Thread';
      const messages = sourceNode.data.messages ?? [];
      const latestAssistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.content.trim().length > 0);
      const latestUser = [...messages]
        .reverse()
        .find((m) => m.role === 'user' && m.content.trim().length > 0);
      const analysis =
        latestAssistant?.content.trim() ||
        latestUser?.content.trim() ||
        (sourceNode.data.draftPrompt ?? '').trim();

      items.push({
        nodeId: sourceNode.id,
        title,
        sourceType: 'chat',
        summaryText: analysis
          ? `Analyst Chat Findings (${title}): ${analysis}`
          : `Analyst Chat Findings (${title}): (no messages yet)`,
      });
    }
  }

  const combinedContextText = items
    .map((item) => item.summaryText)
    .filter((line) => line.trim().length > 0)
    .join(' | ');

  const summaryLabel =
    items.length === 0
      ? 'No context nodes wired'
      : `${items.length} source${items.length === 1 ? '' : 's'}: ${items.map((i) => i.title).join(', ')}`;

  return {
    items,
    imageUrls,
    summaryLabel,
    combinedContextText,
  };
}

/**
 * Formats the exact forensic composite prompt combining user description and connected node context:
 * "Generate a highly realistic forensic composite image based on this description and context: [Combined Data]"
 */
export function buildSuspectCompositePrompt(params: {
  description: string;
  contextText?: string;
}): string {
  const cleanDescription = params.description.trim();
  const cleanContext = (params.contextText ?? '').trim();

  const segments: string[] = [];
  if (cleanDescription) {
    segments.push(`Target Description: ${cleanDescription}`);
  }
  if (cleanContext) {
    segments.push(`Connected Intelligence Context: ${cleanContext}`);
  }

  const combinedData =
    segments.length > 0
      ? segments.join(' | ')
      : 'Unspecified suspect target profile';

  return `Generate a highly realistic forensic composite image based on this description and context: ${combinedData}`;
}

export interface OpenAiDalleRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: {
    model: typeof DALLE_MODEL_ID;
    prompt: string;
    n: 1;
    size: '1024x1024';
    response_format: 'b64_json';
  };
}

/**
 * Builds an OpenAI DALL-E 3 image generation request payload for the server proxy.
 */
export function buildOpenAiDalleRequest(params: {
  apiKey: string;
  prompt: string;
}): OpenAiDalleRequestSpec {
  return {
    url: OPENAI_IMAGES_ENDPOINT,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey.trim()}`,
    },
    body: {
      model: DALLE_MODEL_ID,
      prompt: params.prompt.trim(),
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    },
  };
}

/**
 * Extracts a displayable image URL (base64 data URL or HTTPS URL) from an OpenAI Images API response.
 */
export function extractOpenAiDalleImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0] as { b64_json?: unknown; url?: unknown } | undefined;
  if (!first || typeof first !== 'object') return null;

  if (typeof first.b64_json === 'string' && first.b64_json.trim()) {
    return `data:image/png;base64,${first.b64_json.trim()}`;
  }
  if (typeof first.url === 'string' && first.url.trim()) {
    return first.url.trim();
  }
  return null;
}

export interface ServerImageGenerationRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: {
    provider: LlmProviderId;
    prompt: string;
    images: ParsedInlineImage[];
    apiKey?: string;
  };
}

/**
 * Builds the client-to-server request spec for `/api/image/generate`.
 * Pulls the global API key from localStorage when available and forwards it
 * via both the `x-api-key` header and JSON body.
 */
export function buildServerImageGenerationRequest(params: {
  provider?: LlmProviderId;
  apiKey?: string;
  prompt: string;
  images?: ParsedInlineImage[];
}): ServerImageGenerationRequestSpec {
  const globalSettings = readGlobalSettings();
  const resolvedProvider = params.provider ?? globalSettings.provider;
  const resolvedApiKey =
    params.apiKey?.trim() || getGlobalApiKey(resolvedProvider);

  return {
    url: SERVER_IMAGE_GENERATE_ENDPOINT,
    headers: {
      'Content-Type': 'application/json',
      ...(resolvedApiKey ? { 'x-api-key': resolvedApiKey } : {}),
    },
    body: {
      provider: resolvedProvider,
      prompt: params.prompt.trim(),
      images: params.images ?? [],
      ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
    },
  };
}

/**
 * Calls the backend `/api/image/generate` proxy endpoint to generate a forensic composite image
 * using Google Imagen (`imagen-3.0-generate-001`) or OpenAI DALL-E 3 (`dall-e-3`).
 * Pulls the active provider and API key from global localStorage settings, or lets the server
 * fall back to `.env` / return HTTP 401 when neither is configured.
 */
export async function requestTargetImageGeneration(params: {
  provider?: LlmProviderId;
  apiKey?: string;
  prompt: string;
  images?: ParsedInlineImage[];
  fetchImpl?: typeof fetch;
}): Promise<{ imageUrl: string; modelUsed: string }> {
  const globalSettings = readGlobalSettings();
  const resolvedProvider = params.provider ?? globalSettings.provider;
  const resolvedApiKey =
    params.apiKey?.trim() || getGlobalApiKey(resolvedProvider);

  const fetchFn = params.fetchImpl ?? fetch;
  const spec = buildServerImageGenerationRequest({
    provider: resolvedProvider,
    apiKey: resolvedApiKey || undefined,
    prompt: params.prompt,
    images: params.images,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);

  let response: Response;
  try {
    response = await fetchFn(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
      signal: controller.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (isAbort) {
      throw new Error(
        'Target image generation timed out after 40s. Check your network or API key.',
      );
    }
    throw new Error(
      error instanceof Error
        ? `Network error contacting image backend: ${error.message}`
        : 'Network error contacting image backend.',
    );
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text().catch(() => '');
  let payload: {
    imageUrl?: unknown;
    model?: unknown;
    error?: unknown;
    message?: unknown;
    code?: unknown;
  } | null = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as {
        imageUrl?: unknown;
        model?: unknown;
        error?: unknown;
        message?: unknown;
        code?: unknown;
      };
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errMsg =
      (payload && typeof payload.error === 'string' && payload.error.trim()) ||
      (payload &&
        typeof payload.message === 'string' &&
        payload.message.trim()) ||
      (rawText.trim() && !rawText.trim().startsWith('<')
        ? rawText.trim().slice(0, 300)
        : `Target image generation failed with HTTP ${response.status}.`);
    if (response.status === 401) {
      const code =
        payload && typeof payload.code === 'string' && payload.code.trim()
          ? payload.code.trim()
          : MISSING_API_KEY_CODE;
      throw new ApiAuthError(errMsg || MISSING_API_KEY_MESSAGE, 401, code);
    }
    throw new Error(errMsg);
  }

  const imageUrl =
    payload && typeof payload.imageUrl === 'string'
      ? payload.imageUrl.trim()
      : '';
  if (!imageUrl) {
    throw new Error('Image generation endpoint returned an empty image payload.');
  }

  const modelUsed =
    payload && typeof payload.model === 'string' && payload.model.trim()
      ? payload.model.trim()
      : resolvedProvider === 'openai'
        ? DALLE_MODEL_ID
        : IMAGEN_MODEL_ID;

  return { imageUrl, modelUsed };
}
