import 'dotenv/config';
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import {
  buildAnthropicRequest,
  buildOpenAiCompatibleRequest,
  extractAnthropicResponseText,
  extractOpenAiResponseText,
  getProviderMeta,
  INVALID_GEMINI_MODEL_ERROR,
  isValidGeminiModelName,
  LLM_PROVIDERS,
  normalizeProviderModel,
  parseAvailableModelsResponse,
  readApiErrorMessage,
  resolveModelsEndpointUrl,
  type LlmProviderId,
} from './src/utils/llmProviders';
import type { CustomProviderType } from './src/utils/globalSettings';
import {
  GEOSPY_PREDICT_ENDPOINT,
  parseGeoSpyResponse,
} from './src/utils/geoSpy';
import { checkUsername, OSINT_PLATFORMS } from './src/utils/nativeOsint';
import {
  buildShodanUpstreamUrl,
  normalizeShodanResponse,
} from './src/utils/shodanOsint';
import {
  buildWaybackCdxUrl,
  parseWaybackCdxResponse,
} from './src/utils/archiveOsint';
import {
  buildOpenAiDalleRequest,
  DALLE_MODEL_ID,
  extractOpenAiDalleImageUrl,
  IMAGEN_MODEL_ID,
} from './src/utils/suspectComposite';

// Prefer IPv4 DNS resolution so outbound fetch calls (Gemini, Wayback, OSINT) never stall on broken IPv6 routes.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore on runtimes that do not support setDefaultResultOrder
}

const AI_REQUEST_TIMEOUT_MS = 60_000;
const GEMINI_REST_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_FALLBACK_MODELS = [
  'gemini-1.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
] as const;
const IMAGEN_FALLBACK_MODELS = [
  IMAGEN_MODEL_ID,
  'imagen-3.0-generate-002',
  'imagen-4.0-generate-001',
] as const;

interface InlineImageInput {
  mimeType: string;
  data: string;
}

interface ImageGenerateBody {
  provider?: LlmProviderId;
  apiKey?: string;
  baseUrl?: string;
  providerType?: CustomProviderType;
  model?: string;
  prompt?: string;
  images?: InlineImageInput[];
}

interface LlmGenerateBody {
  provider?: LlmProviderId;
  apiKey?: string;
  baseUrl?: string;
  providerType?: CustomProviderType;
  model?: string;
  promptText?: string;
  images?: InlineImageInput[];
  systemPrompt?: string;
}

interface ProviderModelsBody {
  baseUrl?: string;
  apiKey?: string;
  providerType?: CustomProviderType;
}

interface GeoSpyProxyBody {
  imageBase64?: string;
  mimeType?: string;
  fileName?: string;
}

interface ShodanProxyBody {
  query?: string;
  apiKey?: string;
}

interface ArchiveProxyBody {
  url?: string;
}

function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalLoopbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host === '0.0.0.0'
    );
  } catch {
    return false;
  }
}

const PROVIDER_ENV_KEYS: Record<LlmProviderId, string> = {
  google: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

const MISSING_API_KEY_MESSAGE =
  'Please set your API key in the Dashboard Settings.';
const MISSING_API_KEY_CODE = 'MISSING_API_KEY';

const PLACEHOLDER_ENV_VALUES = new Set([
  'MY_GEMINI_API_KEY',
  'YOUR_ACTUAL_KEY_HERE',
  'YOUR_GEMINI_API_KEY_HERE',
]);

class MissingApiKeyError extends Error {
  readonly status = 401;
  readonly code = MISSING_API_KEY_CODE;
  readonly providerName: string;
  readonly envVarName: string;

  constructor(providerName: string, envVarName: string) {
    super(MISSING_API_KEY_MESSAGE);
    this.name = 'MissingApiKeyError';
    this.providerName = providerName;
    this.envVarName = envVarName;
  }
}

class UpstreamTimeoutError extends Error {
  readonly status = 504;
  readonly code = 'UPSTREAM_TIMEOUT';

  constructor(label: string, timeoutMs: number, customMessage?: string) {
    super(
      customMessage ??
        `${label} request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
    );
    this.name = 'UpstreamTimeoutError';
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  customTimeoutMessage?: string,
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpstreamTimeoutError(label, timeoutMs, customTimeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runWithAbortTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new UpstreamTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeoutPromise]);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpstreamTimeoutError(label, timeoutMs);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describeErrorCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return code ? `${cause.message} (${code})` : cause.message;
  }
  return error.message;
}

function extractReadableErrorMessage(rawMessage: string): string {
  const trimmed = rawMessage.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { message?: unknown; status?: unknown } | string;
        message?: unknown;
      };
      if (
        parsed?.error &&
        typeof parsed.error === 'object' &&
        typeof parsed.error.message === 'string' &&
        parsed.error.message.trim()
      ) {
        return parsed.error.message.trim();
      }
      if (typeof parsed?.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim();
      }
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      // Keep rawMessage when not valid JSON
    }
  }
  return trimmed;
}

function readServerEnvKey(envVarName: string): string {
  const raw = process.env[envVarName];
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDER_ENV_VALUES.has(trimmed)) return '';
  return trimmed;
}

function sanitizeClientApiKey(candidate: unknown): string {
  if (typeof candidate !== 'string') return '';
  const trimmed = candidate.trim();
  if (!trimmed || PLACEHOLDER_ENV_VALUES.has(trimmed)) return '';
  return trimmed;
}

/**
 * Extracts a client-supplied API key from the JSON body or request headers
 * (`x-api-key` or `Authorization: Bearer <key>`).
 */
function extractRequestApiKey(
  req: Request,
  bodyApiKey?: unknown,
): string | undefined {
  const fromBody = sanitizeClientApiKey(bodyApiKey);
  if (fromBody) return fromBody;

  const fromXApiKey = sanitizeClientApiKey(req.header('x-api-key'));
  if (fromXApiKey) return fromXApiKey;

  const authHeader = req.header('authorization');
  if (typeof authHeader === 'string' && authHeader.trim()) {
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    const fromAuth = sanitizeClientApiKey(bearerMatch ? bearerMatch[1] : authHeader);
    if (fromAuth) return fromAuth;
  }

  return undefined;
}

function resolveEffectiveApiKey(
  clientApiKey: string | undefined,
  envVarName: string,
): string {
  const fromClient = sanitizeClientApiKey(clientApiKey);
  if (fromClient) {
    return fromClient;
  }
  return readServerEnvKey(envVarName);
}

function getKeySourceLabel(
  requestApiKey: string | undefined,
  envVarName: string,
): 'request' | 'env' | 'none' {
  if (sanitizeClientApiKey(requestApiKey)) return 'request';
  if (readServerEnvKey(envVarName)) return 'env';
  return 'none';
}

function getGeminiClient(clientApiKey?: string): GoogleGenAI {
  const apiKey = resolveEffectiveApiKey(clientApiKey, 'GEMINI_API_KEY');
  if (!apiKey) {
    throw new MissingApiKeyError('Google', 'GEMINI_API_KEY');
  }
  return new GoogleGenAI({ apiKey });
}

function sanitizeInlineImages(images?: InlineImageInput[]): InlineImageInput[] {
  if (!Array.isArray(images)) return [];
  return images.filter(
    (img): img is InlineImageInput =>
      Boolean(img) &&
      typeof img.mimeType === 'string' &&
      typeof img.data === 'string',
  );
}

function buildGeminiParts(
  promptText: string,
  images?: InlineImageInput[],
): Array<
  | { inlineData: { mimeType: string; data: string } }
  | { text: string }
> {
  const inlineParts = sanitizeInlineImages(images).map((part) => ({
    inlineData: {
      mimeType: part.mimeType,
      data: part.data,
    },
  }));

  return [...inlineParts, { text: promptText }];
}

function formatServerProviderError(
  providerName: string,
  envVarName: string,
  error: unknown,
): {
  status: number;
  message: string;
  code?: string;
} {
  if (error instanceof MissingApiKeyError) {
    return {
      status: 401,
      code: MISSING_API_KEY_CODE,
      message: MISSING_API_KEY_MESSAGE,
    };
  }

  if (error instanceof UpstreamTimeoutError) {
    return {
      status: 504,
      code: 'UPSTREAM_TIMEOUT',
      message: error.message,
    };
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : `${providerName} API request failed on the server.`;
  const readable = extractReadableErrorMessage(rawMessage);

  if (rawMessage.includes(MISSING_API_KEY_MESSAGE)) {
    return {
      status: 401,
      code: MISSING_API_KEY_CODE,
      message: MISSING_API_KEY_MESSAGE,
    };
  }

  if (
    (error instanceof Error && error.name === 'AbortError') ||
    /timed out/i.test(rawMessage)
  ) {
    return {
      status: 504,
      code: 'UPSTREAM_TIMEOUT',
      message: `${providerName} request timed out after 60 seconds.`,
    };
  }

  if (
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('API key not valid') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('is not configured on the server') ||
    rawMessage.includes('401') ||
    rawMessage.includes('invalid x-api-key') ||
    rawMessage.includes('Incorrect API key')
  ) {
    return {
      status: 401,
      code: 'INVALID_API_KEY',
      message: `${readable} Please check your ${providerName} API key in Dashboard Settings (or ${envVarName} on the server).`,
    };
  }

  if (rawMessage.includes('NOT_FOUND') || rawMessage.includes('is not found')) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message: `${readable} Try selecting a supported model (e.g., ${DEFAULT_GEMINI_MODEL}) in Dashboard Settings.`,
    };
  }

  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
    return {
      status: 429,
      message: `${readable} Check quota or billing for ${providerName} (${envVarName}).`,
    };
  }

  if (rawMessage.includes('INVALID_ARGUMENT') || rawMessage.includes('400')) {
    return {
      status: 400,
      message: readable,
    };
  }

  if (rawMessage === 'fetch failed') {
    return {
      status: 502,
      message: `Failed to reach ${providerName} API (${describeErrorCause(error)}).`,
    };
  }

  return {
    status: 500,
    message: readable,
  };
}

function extractGeminiRestText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const first = candidates[0] as {
    content?: { parts?: unknown };
  };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        const t = (part as { text?: unknown }).text;
        return typeof t === 'string' ? t : '';
      }
      return '';
    })
    .join('')
    .trim();
}

/**
 * Direct raw fetch() POST to the Gemini REST API (bypasses @google/genai SDK).
 * Calls `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=...`
 * with a 35s AbortController timeout and automatic 404 fallback across supported Flash models.
 */
async function callGeminiRestGenerateContent(params: {
  apiKey: string;
  model: string;
  promptText: string;
  images: InlineImageInput[];
  systemPrompt?: string;
  timeoutMs?: number;
}): Promise<{ text: string; modelUsed: string }> {
  const {
    apiKey,
    model,
    promptText,
    images,
    systemPrompt,
    timeoutMs = AI_REQUEST_TIMEOUT_MS,
  } = params;

  const cleanImages = sanitizeInlineImages(images);
  const parts: Array<
    | { inline_data: { mime_type: string; data: string } }
    | { text: string }
  > = [
    ...cleanImages.map((img) => ({
      inline_data: {
        mime_type: img.mimeType,
        data: img.data,
      },
    })),
    { text: promptText },
  ];

  const candidateModels: string[] = [model];
  for (const fallback of GEMINI_FALLBACK_MODELS) {
    if (!candidateModels.includes(fallback)) {
      candidateModels.push(fallback);
    }
  }

  let lastError: Error | null = null;

  for (const targetModel of candidateModels) {
    const endpoint = `${GEMINI_REST_BASE}/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const requestBody: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
    };

    if (systemPrompt?.trim()) {
      requestBody.system_instruction = {
        parts: [{ text: systemPrompt.trim() }],
      };
    }

    // Disable hidden thinking tokens on 2.5-flash so OSINT queries respond in ~1-2s instead of stalling
    if (targetModel === 'gemini-2.5-flash') {
      requestBody.generationConfig = {
        thinkingConfig: { thinkingBudget: 0 },
      };
    }

    const upstreamRes = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
      timeoutMs,
      `Google Gemini (${targetModel})`,
      'Network timeout to Google API',
    );

    const rawText = await upstreamRes.text().catch(() => '');
    let json: unknown = null;
    if (rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = null;
      }
    }

    if (!upstreamRes.ok) {
      const errMsg =
        (json ? readApiErrorMessage(json, upstreamRes.status) : '') ||
        rawText.trim() ||
        `Google Gemini API returned HTTP ${upstreamRes.status}.`;
      const err = new Error(errMsg);

      // If this specific model ID is deprecated/not found (404) on the user's API key, try next fallback model
      if (
        upstreamRes.status === 404 ||
        errMsg.includes('NOT_FOUND') ||
        errMsg.includes('is not found')
      ) {
        console.warn(
          `[api] Gemini REST model "${targetModel}" returned 404 (${errMsg}); trying next fallback...`,
        );
        lastError = err;
        continue;
      }

      throw err;
    }

    const text =
      extractGeminiRestText(json) ||
      'Gemini returned an empty response for this inspection.';
    return { text, modelUsed: targetModel };
  }

  throw lastError ?? new Error('No supported Gemini model was found for this API key.');
}

/**
 * Direct raw fetch() POST to the Google Imagen REST API (bypasses @google/genai SDK).
 */
async function callGoogleImagenRest(params: {
  apiKey: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<{ base64Bytes: string; modelUsed: string }> {
  const { apiKey, prompt, timeoutMs = AI_REQUEST_TIMEOUT_MS } = params;
  let lastError: Error | null = null;

  for (const candidateModel of IMAGEN_FALLBACK_MODELS) {
    const endpoint = `${GEMINI_REST_BASE}/${encodeURIComponent(candidateModel)}:predict?key=${encodeURIComponent(apiKey)}`;
    const upstreamRes = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '1:1',
            outputOptions: { mimeType: 'image/jpeg' },
          },
        }),
      },
      timeoutMs,
      `Google Imagen (${candidateModel})`,
      'Network timeout to Google API',
    );

    const rawText = await upstreamRes.text().catch(() => '');
    let json: unknown = null;
    if (rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = null;
      }
    }

    if (!upstreamRes.ok) {
      const errMsg =
        (json ? readApiErrorMessage(json, upstreamRes.status) : '') ||
        rawText.trim() ||
        `Google Imagen API returned HTTP ${upstreamRes.status}.`;
      const err = new Error(errMsg);
      if (
        upstreamRes.status === 404 ||
        errMsg.includes('NOT_FOUND') ||
        errMsg.includes('is not found')
      ) {
        console.warn(
          `[api] Imagen REST model "${candidateModel}" returned 404; trying next fallback...`,
        );
        lastError = err;
        continue;
      }
      throw err;
    }

    const predictions = (json as { predictions?: Array<{ bytesBase64Encoded?: unknown }> } | null)
      ?.predictions;
    const base64Bytes =
      Array.isArray(predictions) &&
      typeof predictions[0]?.bytesBase64Encoded === 'string'
        ? predictions[0].bytesBase64Encoded
        : '';

    if (base64Bytes) {
      return { base64Bytes, modelUsed: candidateModel };
    }
    lastError = new Error(`Imagen API (${candidateModel}) returned no generated image bytes.`);
  }

  throw lastError ?? new Error('Google Imagen failed to generate image bytes.');
}

async function executeProviderGeneration(params: {
  provider: LlmProviderId;
  apiKey?: string;
  baseUrl?: string;
  providerType?: CustomProviderType;
  model: string;
  promptText: string;
  images: InlineImageInput[];
  systemPrompt?: string;
}): Promise<string> {
  const {
    provider,
    apiKey,
    baseUrl,
    providerType,
    model,
    promptText,
    images,
    systemPrompt,
  } = params;

  const cleanBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  if (cleanBaseUrl) {
    const resolvedType: CustomProviderType =
      providerType === 'anthropic' ? 'anthropic' : 'openai';
    const fallbackEnvVar =
      resolvedType === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    const effectiveCustomKey =
      resolveEffectiveApiKey(apiKey, fallbackEnvVar) || '';

    if (!effectiveCustomKey && !isLocalLoopbackUrl(cleanBaseUrl)) {
      throw new MissingApiKeyError('Custom Provider', fallbackEnvVar);
    }

    if (resolvedType === 'anthropic') {
      const spec = buildAnthropicRequest({
        apiKey: effectiveCustomKey,
        model: model.trim() || getProviderMeta('anthropic').defaultModel,
        promptText,
        images,
        systemPrompt,
        baseUrl: cleanBaseUrl,
      });
      const upstreamRes = await fetchWithTimeout(
        spec.url,
        {
          method: 'POST',
          headers: spec.headers,
          body: JSON.stringify(spec.body),
        },
        AI_REQUEST_TIMEOUT_MS,
        'Anthropic Custom Provider',
      );
      const json = (await upstreamRes.json().catch(() => null)) as unknown;
      if (!upstreamRes.ok) {
        throw new Error(readApiErrorMessage(json, upstreamRes.status));
      }
      return (
        extractAnthropicResponseText(json) ||
        'Provider returned an empty response for this inspection.'
      );
    }

    const appOrigin =
      readServerEnvKey('APP_URL') || 'http://localhost:3000';
    const spec = buildOpenAiCompatibleRequest({
      provider: cleanBaseUrl.toLowerCase().includes('openrouter.ai')
        ? 'openrouter'
        : 'openai',
      apiKey: effectiveCustomKey,
      model: model.trim() || getProviderMeta('openai').defaultModel,
      promptText,
      images,
      systemPrompt,
      origin: appOrigin,
      baseUrl: cleanBaseUrl,
    });
    const upstreamRes = await fetchWithTimeout(
      spec.url,
      {
        method: 'POST',
        headers: spec.headers,
        body: JSON.stringify(spec.body),
      },
      AI_REQUEST_TIMEOUT_MS,
      'Custom Provider',
    );
    const json = (await upstreamRes.json().catch(() => null)) as unknown;
    if (!upstreamRes.ok) {
      throw new Error(readApiErrorMessage(json, upstreamRes.status));
    }
    return (
      extractOpenAiResponseText(json) ||
      'Provider returned an empty response for this inspection.'
    );
  }

  const meta = getProviderMeta(provider);
  const envVarName = PROVIDER_ENV_KEYS[provider] ?? meta.envVarName;
  const resolvedModel = normalizeProviderModel(provider, model);

  if (provider === 'google') {
    const effectiveGeminiKey = resolveEffectiveApiKey(apiKey, 'GEMINI_API_KEY');
    if (!effectiveGeminiKey) {
      throw new MissingApiKeyError('Google', 'GEMINI_API_KEY');
    }
    const result = await callGeminiRestGenerateContent({
      apiKey: effectiveGeminiKey,
      model: resolvedModel,
      promptText,
      images,
      systemPrompt,
      timeoutMs: AI_REQUEST_TIMEOUT_MS,
    });
    return result.text;
  }

  const effectiveApiKey = resolveEffectiveApiKey(apiKey, envVarName);
  if (!effectiveApiKey) {
    throw new MissingApiKeyError(meta.name, envVarName);
  }

  if (provider === 'anthropic') {
    const spec = buildAnthropicRequest({
      apiKey: effectiveApiKey,
      model: resolvedModel,
      promptText,
      images,
      systemPrompt,
    });
    const upstreamRes = await fetchWithTimeout(
      spec.url,
      {
        method: 'POST',
        headers: spec.headers,
        body: JSON.stringify(spec.body),
      },
      AI_REQUEST_TIMEOUT_MS,
      'Anthropic',
    );
    const json = (await upstreamRes.json().catch(() => null)) as unknown;
    if (!upstreamRes.ok) {
      throw new Error(readApiErrorMessage(json, upstreamRes.status));
    }
    return (
      extractAnthropicResponseText(json) ||
      'Anthropic returned an empty response for this inspection.'
    );
  }

  const appOrigin =
    readServerEnvKey('APP_URL') || 'http://localhost:3000';
  const spec = buildOpenAiCompatibleRequest({
    provider,
    apiKey: effectiveApiKey,
    model: resolvedModel,
    promptText,
    images,
    systemPrompt,
    origin: appOrigin,
  });

  const upstreamRes = await fetchWithTimeout(
    spec.url,
    {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
    },
    AI_REQUEST_TIMEOUT_MS,
    meta.name,
  );
  const json = (await upstreamRes.json().catch(() => null)) as unknown;
  if (!upstreamRes.ok) {
    throw new Error(readApiErrorMessage(json, upstreamRes.status));
  }
  return (
    extractOpenAiResponseText(json) ||
    `${meta.name} returned an empty response for this inspection.`
  );
}

let isServerStarted = false;

const WS_CLOSE_UNAUTHORIZED = 4001;
const WS_AUTH_TIMEOUT_MS = 5_000;

function generateSyncPin(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

function isValidPinMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isLoopbackAddress(address?: string): boolean {
  if (!address) return false;
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

export async function startServer() {
  if (isServerStarted) return;
  isServerStarted = true;
  const app = express();
  const host = process.env.HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.PORT) || 3000;
  const wsPin = generateSyncPin();
  const allowedOrigins = (
    process.env.CORS_ORIGINS ||
    'http://127.0.0.1:3000,http://localhost:3000,http://localhost:5173'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const osintTimeoutMs = Number(process.env.OSINT_TIMEOUT_MS) || 5_000;

  app.use(
    cors({
      origin(origin, callback) {
        // Allow requests with no Origin header (curl, native mobile clients, same-origin).
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Loopback-only endpoint so the local desktop canvas can automatically pair with the /sync WebSocket.
  // Remote LAN clients receive 403 and must manually enter the 6-digit PIN printed in the terminal.
  app.get('/api/sync/pin', (req: Request, res: Response) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({
        error: 'WebSocket PIN lookup is restricted to localhost. Enter the PIN from the terminal.',
      });
      return;
    }
    res.json({ pin: wsPin });
  });

  // Returns server-side configuration status for all providers without exposing any secret values
  app.get('/api/providers/status', (_req: Request, res: Response) => {
    const providers = Object.fromEntries(
      LLM_PROVIDERS.map((p) => [
        p.id,
        Boolean(readServerEnvKey(p.envVarName)),
      ]),
    ) as Record<LlmProviderId, boolean>;

    res.json({
      providers,
      geospy: Boolean(readServerEnvKey('GEOSPY_API_KEY')),
    });
  });

  // Fetches available models from any OpenAI-compatible or Anthropic provider endpoint (`${baseUrl}/models`)
  app.post('/api/providers/models', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ProviderModelsBody;
    const rawBaseUrl =
      typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const providerType: CustomProviderType =
      body.providerType === 'anthropic' ? 'anthropic' : 'openai';
    const requestApiKey = extractRequestApiKey(req, body.apiKey);

    if (!rawBaseUrl || !isValidHttpUrl(rawBaseUrl)) {
      res.status(400).json({
        error: 'A valid http:// or https:// baseUrl is required.',
      });
      return;
    }

    const modelsUrl = resolveModelsEndpointUrl(rawBaseUrl, providerType);
    const keyPrefix = requestApiKey ? `${requestApiKey.slice(0, 4)}...` : 'NONE';
    console.log(
      `[api] POST /api/providers/models received (providerType=${providerType}, url=${modelsUrl}, keyPrefix=${keyPrefix})`,
    );

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (providerType === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      if (requestApiKey) {
        headers['x-api-key'] = requestApiKey;
      }
    } else if (requestApiKey) {
      headers.Authorization = `Bearer ${requestApiKey}`;
    }

    try {
      let upstreamRes = await fetchWithTimeout(
        modelsUrl,
        {
          method: 'GET',
          headers,
        },
        20_000,
        'Provider Models',
      );

      // Convenience fallback for local servers like Ollama when user enters `http://localhost:11434` without `/v1`
      if (
        upstreamRes.status === 404 &&
        providerType === 'openai' &&
        !/\/v1\/models$/i.test(modelsUrl)
      ) {
        const cleanBase = rawBaseUrl.replace(/\/+$/, '');
        const fallbackUrl = `${cleanBase}/v1/models`;
        const fallbackRes = await fetchWithTimeout(
          fallbackUrl,
          {
            method: 'GET',
            headers,
          },
          20_000,
          'Provider Models',
        );
        if (fallbackRes.ok) {
          upstreamRes = fallbackRes;
        }
      }

      const rawText = await upstreamRes.text().catch(() => '');
      let json: unknown = null;
      if (rawText) {
        try {
          json = JSON.parse(rawText);
        } catch {
          json = null;
        }
      }

      if (!upstreamRes.ok) {
        const errMsg =
          (json ? readApiErrorMessage(json, upstreamRes.status) : '') ||
          `Failed to fetch models (HTTP ${upstreamRes.status}).`;
        console.error(
          `[api] POST /api/providers/models upstream error (${upstreamRes.status}): ${errMsg}`,
        );
        res.status(upstreamRes.status).json({ error: errMsg });
        return;
      }

      const models = parseAvailableModelsResponse(json);
      console.log(
        `[api] POST /api/providers/models succeeded (count=${models.length}, url=${modelsUrl})`,
      );
      res.json({ models });
    } catch (error) {
      const isTimeout = error instanceof UpstreamTimeoutError;
      const message = isTimeout
        ? error.message
        : `Failed to fetch models from ${modelsUrl} (${describeErrorCause(error)}).`;
      console.error(`[api] POST /api/providers/models failed: ${message}`);
      res.status(isTimeout ? 504 : 502).json({ error: message });
    }
  });

  // Unified server-side proxy route for all LLM providers (custom OpenAI-compatible/Anthropic baseUrl + built-in providers)
  const handleLlmGenerate = async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LlmGenerateBody;
    const promptText =
      typeof body.promptText === 'string' ? body.promptText.trim() : '';

    if (!promptText) {
      res.status(400).json({ error: 'promptText is required.' });
      return;
    }

    const customBaseUrl =
      typeof body.baseUrl === 'string'
        ? body.baseUrl.trim().replace(/\/+$/, '')
        : '';
    if (customBaseUrl && !isValidHttpUrl(customBaseUrl)) {
      res.status(400).json({
        error: 'baseUrl must be a valid http:// or https:// URL.',
      });
      return;
    }
    const customProviderType: CustomProviderType | undefined = customBaseUrl
      ? body.providerType === 'anthropic'
        ? 'anthropic'
        : 'openai'
      : undefined;

    const providerId: LlmProviderId =
      body.provider &&
      LLM_PROVIDERS.some((p) => p.id === body.provider)
        ? body.provider
        : 'google';

    const rawModel = typeof body.model === 'string' ? body.model.trim() : '';
    if (
      !customBaseUrl &&
      rawModel &&
      (rawModel.toLowerCase().includes('gemini') || providerId === 'google') &&
      !isValidGeminiModelName(rawModel)
    ) {
      console.error(
        `[api] POST ${req.path} rejected (400 INVALID_GEMINI_MODEL: "${rawModel}")`,
      );
      res.status(400).json({ error: INVALID_GEMINI_MODEL_ERROR });
      return;
    }

    const meta = getProviderMeta(providerId);
    const envVarName = customBaseUrl
      ? customProviderType === 'anthropic'
        ? 'ANTHROPIC_API_KEY'
        : 'OPENAI_API_KEY'
      : PROVIDER_ENV_KEYS[providerId] ?? meta.envVarName;
    const resolvedModel = customBaseUrl
      ? rawModel || meta.defaultModel
      : normalizeProviderModel(providerId, body.model);
    const systemPrompt =
      typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    const images = sanitizeInlineImages(body.images);
    const requestApiKey = extractRequestApiKey(req, body.apiKey);
    const keySource = getKeySourceLabel(requestApiKey, envVarName);
    const effectiveKeyForLog = resolveEffectiveApiKey(requestApiKey, envVarName);
    const keyPrefix = effectiveKeyForLog
      ? `${effectiveKeyForLog.slice(0, 4)}...`
      : 'NONE';

    console.log(
      `[api] POST ${req.path} received (provider=${customBaseUrl ? `custom:${customProviderType}` : providerId}, model=${resolvedModel}, baseUrl=${customBaseUrl || 'default'}, keySource=${keySource}, keyPrefix=${keyPrefix}, images=${images.length}, promptChars=${promptText.length})`,
    );

    if (
      keySource === 'none' &&
      !(customBaseUrl && isLocalLoopbackUrl(customBaseUrl))
    ) {
      console.error(
        `[api] POST ${req.path} rejected (401 MISSING_API_KEY for provider=${providerId})`,
      );
      res.status(401).json({
        error: MISSING_API_KEY_MESSAGE,
        code: MISSING_API_KEY_CODE,
      });
      return;
    }

    try {
      const text = await executeProviderGeneration({
        provider: providerId,
        apiKey: requestApiKey,
        baseUrl: customBaseUrl || undefined,
        providerType: customProviderType,
        model: resolvedModel,
        promptText,
        images,
        systemPrompt,
      });
      console.log(
        `[api] POST ${req.path} succeeded (provider=${customBaseUrl ? `custom:${customProviderType}` : providerId}, model=${resolvedModel}, responseChars=${text.length})`,
      );
      res.json({ text });
    } catch (error) {
      const formatted = formatServerProviderError(
        customBaseUrl ? 'Custom Provider' : meta.name,
        envVarName,
        error,
      );
      console.error(
        `[api] POST ${req.path} failed (status=${formatted.status}, provider=${providerId}, model=${resolvedModel}): ${formatted.message}`,
      );
      res.status(formatted.status).json({
        error: formatted.message,
        ...(formatted.code ? { code: formatted.code } : {}),
      });
    }
  };

  app.post('/api/llm/generate', handleLlmGenerate);
  app.post('/api/llm/complete', handleLlmGenerate);

  // Dedicated Gemini generation endpoint
  app.post('/api/gemini/generate', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LlmGenerateBody;
    const promptText =
      typeof body.promptText === 'string' ? body.promptText.trim() : '';

    if (!promptText) {
      res.status(400).json({ error: 'promptText is required.' });
      return;
    }

    const rawModel = typeof body.model === 'string' ? body.model.trim() : '';
    if (rawModel && !isValidGeminiModelName(rawModel)) {
      console.error(
        `[api] POST /api/gemini/generate rejected (400 INVALID_GEMINI_MODEL: "${rawModel}")`,
      );
      res.status(400).json({ error: INVALID_GEMINI_MODEL_ERROR });
      return;
    }

    const resolvedModel = normalizeProviderModel('google', body.model);
    const systemPrompt =
      typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    const images = sanitizeInlineImages(body.images);
    const requestApiKey = extractRequestApiKey(req, body.apiKey);
    const keySource = getKeySourceLabel(requestApiKey, 'GEMINI_API_KEY');
    const effectiveGeminiKey = resolveEffectiveApiKey(
      requestApiKey,
      'GEMINI_API_KEY',
    );
    const keyPrefix = effectiveGeminiKey
      ? `${effectiveGeminiKey.slice(0, 4)}...`
      : 'NONE';

    console.log(
      `[api] POST /api/gemini/generate received (model=${resolvedModel}, keySource=${keySource}, keyPrefix=${keyPrefix}, images=${images.length})`,
    );

    if (keySource === 'none') {
      console.error('[api] POST /api/gemini/generate rejected (401 MISSING_API_KEY)');
      res.status(401).json({
        error: MISSING_API_KEY_MESSAGE,
        code: MISSING_API_KEY_CODE,
      });
      return;
    }

    try {
      const text = await executeProviderGeneration({
        provider: 'google',
        apiKey: requestApiKey,
        model: resolvedModel,
        promptText,
        images,
        systemPrompt,
      });
      console.log(
        `[api] POST /api/gemini/generate succeeded (model=${resolvedModel}, responseChars=${text.length})`,
      );
      res.json({ text });
    } catch (error) {
      const formatted = formatServerProviderError(
        'Google',
        'GEMINI_API_KEY',
        error,
      );
      console.error(
        `[api] POST /api/gemini/generate failed (status=${formatted.status}, model=${resolvedModel}): ${formatted.message}`,
      );
      res.status(formatted.status).json({
        error: formatted.message,
        ...(formatted.code ? { code: formatted.code } : {}),
      });
    }
  });

  // Dedicated Gemini streaming endpoint
  app.post('/api/gemini/stream', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LlmGenerateBody;
    const promptText =
      typeof body.promptText === 'string' ? body.promptText.trim() : '';

    if (!promptText) {
      res.status(400).json({ error: 'promptText is required.' });
      return;
    }

    const rawModel = typeof body.model === 'string' ? body.model.trim() : '';
    if (rawModel && !isValidGeminiModelName(rawModel)) {
      console.error(
        `[api] POST /api/gemini/stream rejected (400 INVALID_GEMINI_MODEL: "${rawModel}")`,
      );
      res.status(400).json({ error: INVALID_GEMINI_MODEL_ERROR });
      return;
    }

    const resolvedModel = normalizeProviderModel('google', body.model);
    const systemPrompt =
      typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    const requestApiKey = extractRequestApiKey(req, body.apiKey);
    const keySource = getKeySourceLabel(requestApiKey, 'GEMINI_API_KEY');

    console.log(
      `[api] POST /api/gemini/stream received (model=${resolvedModel}, keySource=${keySource})`,
    );

    let ai: GoogleGenAI;
    try {
      ai = getGeminiClient(requestApiKey);
    } catch (error) {
      const formatted = formatServerProviderError(
        'Google',
        'GEMINI_API_KEY',
        error,
      );
      console.error(
        `[api] POST /api/gemini/stream failed before stream (status=${formatted.status}): ${formatted.message}`,
      );
      res.status(formatted.status).json({
        error: formatted.message,
        ...(formatted.code ? { code: formatted.code } : {}),
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const parts = buildGeminiParts(promptText, body.images);

      const streamResponse = await runWithAbortTimeout(
        (abortSignal) =>
          ai.models.generateContentStream({
            model: resolvedModel,
            contents: { parts },
            config: {
              abortSignal,
              ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
            },
          }),
        AI_REQUEST_TIMEOUT_MS,
        `Google Gemini Stream (${resolvedModel})`,
      );

      for await (const chunk of streamResponse) {
        const c = chunk as GenerateContentResponse;
        const chunkText = c.text ?? '';
        if (chunkText) {
          res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      const formatted = formatServerProviderError(
        'Google',
        'GEMINI_API_KEY',
        error,
      );
      console.error(
        `[api] POST /api/gemini/stream error (status=${formatted.status}): ${formatted.message}`,
      );
      res.write(`data: ${JSON.stringify({ error: formatted.message })}\n\n`);
      res.end();
    }
  });

  // Server-side GeoSpy geolocation proxy endpoint using GEOSPY_API_KEY
  app.post('/api/osint/geospy', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as GeoSpyProxyBody;
    const imageBase64 =
      typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
    const mimeType =
      typeof body.mimeType === 'string' && body.mimeType.trim()
        ? body.mimeType.trim()
        : 'image/jpeg';
    const fileName =
      typeof body.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim()
        : 'evidence.jpg';

    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 is required.' });
      return;
    }

    const requestKey = extractRequestApiKey(req);
    const geoSpyKey = resolveEffectiveApiKey(requestKey, 'GEOSPY_API_KEY');
    console.log(
      `[api] POST /api/osint/geospy received (file=${fileName}, keySource=${getKeySourceLabel(requestKey, 'GEOSPY_API_KEY')})`,
    );

    if (!geoSpyKey) {
      console.error('[api] POST /api/osint/geospy rejected (401 MISSING_API_KEY)');
      res.status(401).json({
        error:
          'GEOSPY_API_KEY is not configured. Add GEOSPY_API_KEY in .env or pass a key.',
        code: MISSING_API_KEY_CODE,
      });
      return;
    }

    try {
      const binaryBuffer = Buffer.from(imageBase64, 'base64');
      const blob = new Blob([binaryBuffer], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, fileName);

      const upstreamRes = await fetchWithTimeout(
        GEOSPY_PREDICT_ENDPOINT,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${geoSpyKey}`,
          },
          body: formData,
        },
        AI_REQUEST_TIMEOUT_MS,
        'GeoSpy',
      );

      if (!upstreamRes.ok) {
        let errorDetail = `GeoSpy API request failed (${upstreamRes.status}).`;
        try {
          const errorJson = (await upstreamRes.json()) as {
            detail?: unknown;
            error?: unknown;
            message?: unknown;
          };
          const candidate =
            errorJson.detail ?? errorJson.message ?? errorJson.error;
          if (typeof candidate === 'string' && candidate.trim()) {
            errorDetail = candidate.trim();
          }
        } catch {
          // Ignore non-JSON error body
        }
        console.error(
          `[api] POST /api/osint/geospy upstream error (${upstreamRes.status}): ${errorDetail}`,
        );
        res.status(upstreamRes.status).json({ error: errorDetail });
        return;
      }

      const data = (await upstreamRes.json()) as unknown;
      const prediction = parseGeoSpyResponse(data);
      if (!prediction) {
        console.error('[api] POST /api/osint/geospy invalid prediction payload');
        res.status(502).json({
          error: 'GeoSpy response did not include valid lat/lng coordinates.',
        });
        return;
      }
      res.json({ prediction });
    } catch (error) {
      const formatted = formatServerProviderError(
        'GeoSpy',
        'GEOSPY_API_KEY',
        error,
      );
      console.error(
        `[api] POST /api/osint/geospy failed (status=${formatted.status}): ${formatted.message}`,
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Native JS username pivot endpoint (7 platforms in parallel with soft-404 & WAF handling)
  const PIVOT_USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
  app.post('/api/osint/pivot', async (req: Request, res: Response) => {
    const username =
      req.body && typeof (req.body as { username?: unknown }).username === 'string'
        ? (req.body as { username: string }).username.trim()
        : '';

    if (!PIVOT_USERNAME_RE.test(username)) {
      res.status(400).json({
        error:
          'Invalid or missing "username" (allowed: A-Z a-z 0-9 . _ -, max 64).',
      });
      return;
    }

    try {
      const { found, checks } = await checkUsername(username, {
        timeoutMs: osintTimeoutMs,
      });
      res.json({ username, source: 'native', found, checks });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Server username pivot failed.';
      console.error(`[api] POST /api/osint/pivot failed: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  // Server-side Shodan Host Search / IP Lookup proxy endpoint (bypasses browser CORS)
  app.post('/api/osint/shodan', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ShodanProxyBody;
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'query is required.' });
      return;
    }

    const requestShodanKey = extractRequestApiKey(req, body.apiKey);
    const shodanKey = resolveEffectiveApiKey(requestShodanKey, 'SHODAN_API_KEY');
    console.log(
      `[api] POST /api/osint/shodan received (query=${query}, keySource=${getKeySourceLabel(requestShodanKey, 'SHODAN_API_KEY')})`,
    );

    if (!shodanKey) {
      res.status(403).json({
        error:
          'Please set your Shodan API key in the Dashboard Settings (or in the Shodan node).',
      });
      return;
    }

    const { url: upstreamUrl, mode } = buildShodanUpstreamUrl(query, shodanKey);

    try {
      const upstreamRes = await fetchWithTimeout(
        upstreamUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Trace-OSINT/1.0',
          },
        },
        15_000,
        'Shodan',
      );

      const payload = (await upstreamRes.json().catch(() => null)) as unknown;
      if (!upstreamRes.ok) {
        const message = readApiErrorMessage(payload, upstreamRes.status);
        console.error(
          `[api] POST /api/osint/shodan upstream error (${upstreamRes.status}): ${message}`,
        );
        res.status(upstreamRes.status).json({ error: message });
        return;
      }

      const normalized = normalizeShodanResponse(payload, mode);
      res.json({
        query,
        mode,
        total: normalized.total,
        results: normalized.results,
      });
    } catch (error) {
      const isTimeout = error instanceof UpstreamTimeoutError;
      const message = isTimeout
        ? error.message
        : `Shodan lookup failed on the server (${describeErrorCause(error)}).`;
      console.error(`[api] POST /api/osint/shodan failed: ${message}`);
      res.status(isTimeout ? 504 : 502).json({ error: message });
    }
  });

  // Server-side Wayback Machine CDX API proxy endpoint (bypasses browser CORS)
  app.post('/api/osint/archive', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ArchiveProxyBody;
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    if (!rawUrl || /\s/.test(rawUrl)) {
      res.status(400).json({ error: 'A valid target url is required.' });
      return;
    }

    const cdxUrl = buildWaybackCdxUrl(rawUrl, 20);
    console.log(`[api] POST /api/osint/archive received (url=${rawUrl})`);

    try {
      const upstreamRes = await fetchWithTimeout(
        cdxUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Trace-OSINT/1.0',
          },
        },
        AI_REQUEST_TIMEOUT_MS,
        'Wayback Machine CDX',
      );

      if (!upstreamRes.ok) {
        console.error(
          `[api] POST /api/osint/archive upstream HTTP ${upstreamRes.status} for ${rawUrl}`,
        );
        res.status(upstreamRes.status).json({
          error: `Wayback Machine CDX API returned HTTP ${upstreamRes.status}.`,
        });
        return;
      }

      const payload = (await upstreamRes.json().catch(() => null)) as unknown;
      const snapshots = parseWaybackCdxResponse(payload);
      console.log(
        `[api] POST /api/osint/archive succeeded (url=${rawUrl}, snapshots=${snapshots.length})`,
      );
      res.json({
        url: rawUrl,
        snapshots,
      });
    } catch (error) {
      const isTimeout = error instanceof UpstreamTimeoutError;
      const message = isTimeout
        ? error.message
        : `Wayback Machine archive lookup failed (${describeErrorCause(error)}).`;
      console.error(`[api] POST /api/osint/archive failed: ${message}`);
      res.status(isTimeout ? 504 : 502).json({ error: message });
    }
  });

  // Server-side Target / Suspect Composite Image Generation endpoint (Google Imagen 3 & OpenAI DALL-E 3)
  app.post('/api/image/generate', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ImageGenerateBody;
    const rawPrompt =
      typeof body.prompt === 'string' ? body.prompt.trim() : '';

    if (!rawPrompt) {
      res.status(400).json({ error: 'prompt is required.' });
      return;
    }

    const customBaseUrl =
      typeof body.baseUrl === 'string'
        ? body.baseUrl.trim().replace(/\/+$/, '')
        : '';
    if (customBaseUrl && !isValidHttpUrl(customBaseUrl)) {
      res.status(400).json({
        error: 'baseUrl must be a valid http:// or https:// URL.',
      });
      return;
    }
    const customProviderType: CustomProviderType | undefined = customBaseUrl
      ? body.providerType === 'anthropic'
        ? 'anthropic'
        : 'openai'
      : undefined;

    const providerId: LlmProviderId =
      body.provider && LLM_PROVIDERS.some((p) => p.id === body.provider)
        ? body.provider
        : 'google';
    const inlineImages = sanitizeInlineImages(body.images);
    const requestApiKey = extractRequestApiKey(req, body.apiKey);
    const envVarName =
      customBaseUrl || providerId === 'openai'
        ? 'OPENAI_API_KEY'
        : 'GEMINI_API_KEY';
    const keySource = getKeySourceLabel(requestApiKey, envVarName);
    const effectiveKeyForLog = resolveEffectiveApiKey(requestApiKey, envVarName);
    const keyPrefix = effectiveKeyForLog
      ? `${effectiveKeyForLog.slice(0, 4)}...`
      : 'NONE';

    console.log(
      `[api] POST /api/image/generate received (provider=${customBaseUrl ? `custom:${customProviderType}` : providerId}, baseUrl=${customBaseUrl || 'default'}, keySource=${keySource}, keyPrefix=${keyPrefix}, refImages=${inlineImages.length}, promptChars=${rawPrompt.length})`,
    );

    if (customBaseUrl && customProviderType === 'anthropic') {
      res.status(400).json({
        error:
          'Anthropic providers do not expose a native image generation endpoint. Select an OpenAI-compatible image provider in Global Settings.',
      });
      return;
    }

    if (providerId === 'openai' || (customBaseUrl && customProviderType === 'openai')) {
      const openAiKey =
        resolveEffectiveApiKey(requestApiKey, 'OPENAI_API_KEY') || '';
      if (!openAiKey && !(customBaseUrl && isLocalLoopbackUrl(customBaseUrl))) {
        console.error('[api] POST /api/image/generate rejected (401 MISSING_API_KEY for openai)');
        res.status(401).json({
          error: MISSING_API_KEY_MESSAGE,
          code: MISSING_API_KEY_CODE,
        });
        return;
      }

      try {
        const requestedModel =
          typeof body.model === 'string' && body.model.trim()
            ? body.model.trim()
            : DALLE_MODEL_ID;
        const dalleSpec = buildOpenAiDalleRequest({
          apiKey: openAiKey,
          prompt: rawPrompt,
          baseUrl: customBaseUrl || undefined,
          model: customBaseUrl ? requestedModel : DALLE_MODEL_ID,
        });
        const upstreamRes = await fetchWithTimeout(
          dalleSpec.url,
          {
            method: 'POST',
            headers: dalleSpec.headers,
            body: JSON.stringify(dalleSpec.body),
          },
          AI_REQUEST_TIMEOUT_MS,
          customBaseUrl ? 'Custom Image Provider' : 'OpenAI DALL-E 3',
        );
        const json = (await upstreamRes.json().catch(() => null)) as unknown;
        if (!upstreamRes.ok) {
          throw new Error(readApiErrorMessage(json, upstreamRes.status));
        }

        const imageUrl = extractOpenAiDalleImageUrl(json);
        if (!imageUrl) {
          throw new Error('Image generation API returned an empty image payload.');
        }

        console.log(
          `[api] POST /api/image/generate succeeded (provider=${customBaseUrl ? 'custom' : 'openai'}, model=${dalleSpec.body.model})`,
        );
        res.json({
          imageUrl,
          model: dalleSpec.body.model,
          provider: customBaseUrl ? 'custom' : 'openai',
        });
      } catch (error) {
        const formatted = formatServerProviderError(
          customBaseUrl ? 'Custom Image Provider' : 'OpenAI DALL-E 3',
          'OPENAI_API_KEY',
          error,
        );
        console.error(
          `[api] POST /api/image/generate failed (provider=${customBaseUrl ? 'custom' : 'openai'}, status=${formatted.status}): ${formatted.message}`,
        );
        res.status(formatted.status).json({
          error: formatted.message,
          ...(formatted.code ? { code: formatted.code } : {}),
        });
      }
      return;
    }

    if (providerId !== 'google') {
      res.status(400).json({
        error: `${getProviderMeta(providerId).name} does not expose a native image generation endpoint. Select Google (Imagen 3) or OpenAI (DALL-E 3) in Dashboard Settings.`,
      });
      return;
    }

    // Provider is Google: Call Imagen REST API directly via raw fetch() (bypasses @google/genai SDK)
    const geminiKey = resolveEffectiveApiKey(requestApiKey, 'GEMINI_API_KEY');
    if (!geminiKey) {
      console.error('[api] POST /api/image/generate rejected (401 MISSING_API_KEY for google)');
      res.status(401).json({
        error: MISSING_API_KEY_MESSAGE,
        code: MISSING_API_KEY_CODE,
      });
      return;
    }

    try {
      let finalPrompt = rawPrompt;

      // If connected ImageNodes were passed, optionally extract brief visual traits via raw Gemini REST (capped at 10s)
      if (inlineImages.length > 0) {
        try {
          const visionResult = await callGeminiRestGenerateContent({
            apiKey: geminiKey,
            model: DEFAULT_GEMINI_MODEL,
            promptText:
              'Summarize the key physical subject, attire, and facial/structural traits visible in this reference frame in 2 concise sentences for a forensic composite.',
            images: inlineImages,
            timeoutMs: 10_000,
          });
          if (visionResult.text) {
            finalPrompt = `${rawPrompt} | Visual Traits from Connected ImageNode: ${visionResult.text}`;
          }
        } catch (visionErr) {
          console.warn(
            `[api] POST /api/image/generate vision enrichment skipped: ${describeErrorCause(visionErr)}`,
          );
        }
      }

      const { base64Bytes, modelUsed } = await callGoogleImagenRest({
        apiKey: geminiKey,
        prompt: finalPrompt,
        timeoutMs: AI_REQUEST_TIMEOUT_MS,
      });

      console.log(
        `[api] POST /api/image/generate succeeded (provider=google, model=${modelUsed})`,
      );
      res.json({
        imageUrl: `data:image/jpeg;base64,${base64Bytes}`,
        model: modelUsed,
        provider: 'google',
      });
    } catch (error) {
      const formatted = formatServerProviderError(
        'Google Imagen',
        'GEMINI_API_KEY',
        error,
      );
      console.error(
        `[api] POST /api/image/generate failed (provider=google, status=${formatted.status}): ${formatted.message}`,
      );
      res.status(formatted.status).json({
        error: formatted.message,
        ...(formatted.code ? { code: formatted.code } : {}),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Local Filesystem Project Persistence (/data/<project_id>.json)
  // ---------------------------------------------------------------------------
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = process.env.TRACE_DATA_DIR?.trim()
    ? path.resolve(process.env.TRACE_DATA_DIR.trim())
    : path.resolve(serverDir, 'data');

  fs.mkdirSync(dataDir, { recursive: true });

  const PROJECT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

  function resolveSafeProjectFilePath(projectId: string): string | null {
    if (!PROJECT_ID_RE.test(projectId) || projectId.includes('..')) {
      return null;
    }
    const candidate = path.resolve(dataDir, `${projectId}.json`);
    if (!candidate.startsWith(dataDir + path.sep)) {
      return null;
    }
    return candidate;
  }

  // Save a project JSON payload to /data/<project_id>.json
  app.post('/api/projects/save', async (req: Request, res: Response) => {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const payload =
      rawBody.project && typeof rawBody.project === 'object'
        ? (rawBody.project as Record<string, unknown>)
        : rawBody;

    const projectId =
      typeof payload.id === 'string' ? payload.id.trim() : '';
    const filePath = resolveSafeProjectFilePath(projectId);
    if (!filePath) {
      res.status(400).json({
        error:
          'A valid project "id" is required (alphanumeric, ".", "_", "-", max 128 chars).',
      });
      return;
    }

    const name =
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : 'Untitled Project';
    const createdAt =
      typeof payload.createdAt === 'string' && payload.createdAt.trim()
        ? payload.createdAt.trim()
        : new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const edges = Array.isArray(payload.edges) ? payload.edges : [];
    const nodeCounter =
      typeof payload.nodeCounter === 'number' &&
      Number.isFinite(payload.nodeCounter) &&
      payload.nodeCounter >= 1
        ? payload.nodeCounter
        : Math.max(nodes.length + 1, 1);

    const projectRecord = {
      id: projectId,
      name,
      createdAt,
      updatedAt,
      nodes,
      edges,
      nodeCounter,
    };

    try {
      await fsp.mkdir(dataDir, { recursive: true });
      const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
      await fsp.writeFile(
        tmpPath,
        JSON.stringify(projectRecord, null, 2),
        'utf8',
      );
      await fsp.rename(tmpPath, filePath);

      res.json({
        ok: true,
        id: projectId,
        name,
        createdAt,
        updatedAt,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save project file on server.';
      res.status(500).json({ error: message });
    }
  });

  // List all saved project JSON files in /data (IDs, names, and metadata)
  app.get('/api/projects', async (_req: Request, res: Response) => {
    try {
      await fsp.mkdir(dataDir, { recursive: true });
      const entries = await fsp.readdir(dataDir, { withFileTypes: true });
      const jsonFiles = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith('.json'),
      );

      const summaries: Array<{
        id: string;
        name: string;
        createdAt: string;
        updatedAt: string;
        nodeCount: number;
        edgeCount: number;
      }> = [];

      for (const file of jsonFiles) {
        const filePath = path.join(dataDir, file.name);
        try {
          const raw = await fsp.readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const fallbackId = file.name.slice(0, -'.json'.length);
          const id =
            typeof parsed.id === 'string' && parsed.id.trim()
              ? parsed.id.trim()
              : fallbackId;
          const name =
            typeof parsed.name === 'string' && parsed.name.trim()
              ? parsed.name.trim()
              : 'Untitled Project';
          const stat = await fsp.stat(filePath);
          const createdAt =
            typeof parsed.createdAt === 'string' && parsed.createdAt.trim()
              ? parsed.createdAt.trim()
              : stat.birthtime.toISOString();
          const updatedAt =
            typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim()
              ? parsed.updatedAt.trim()
              : stat.mtime.toISOString();
          const nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
          const edgeCount = Array.isArray(parsed.edges) ? parsed.edges.length : 0;

          summaries.push({
            id,
            name,
            createdAt,
            updatedAt,
            nodeCount,
            edgeCount,
          });
        } catch {
          // Skip malformed or transient JSON files
        }
      }

      summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      res.json({ projects: summaries });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to list saved projects.';
      res.status(500).json({ error: message });
    }
  });

  // Load a specific project JSON from /data/<id>.json
  app.get('/api/projects/:id', async (req: Request, res: Response) => {
    const projectId =
      typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const filePath = resolveSafeProjectFilePath(projectId);
    if (!filePath) {
      res.status(400).json({ error: 'Invalid project ID.' });
      return;
    }

    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      res.json(parsed);
    } catch (error) {
      const errCode = (error as NodeJS.ErrnoException | null)?.code;
      if (errCode === 'ENOENT') {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to read project file.';
      res.status(500).json({ error: message });
    }
  });

  // Delete a saved project JSON from /data/<id>.json
  app.delete('/api/projects/:id', async (req: Request, res: Response) => {
    const projectId =
      typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const filePath = resolveSafeProjectFilePath(projectId);
    if (!filePath) {
      res.status(400).json({ error: 'Invalid project ID.' });
      return;
    }

    try {
      await fsp.unlink(filePath);
      res.json({ ok: true, id: projectId });
    } catch (error) {
      const errCode = (error as NodeJS.ErrnoException | null)?.code;
      if (errCode === 'ENOENT') {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to delete project file.';
      res.status(500).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);

  // Mobile companion sync relay on /sync (PIN-authenticated; coexists with Vite HMR via noServer upgrade routing)
  const wss = new WebSocketServer({ noServer: true });
  const authenticatedClients = new Set<WebSocket>();

  wss.on('connection', (ws, req) => {
    const peer = req.socket.remoteAddress;
    console.log(`[ws] pending client connected from ${peer} (awaiting PIN auth)`);

    const authTimer = setTimeout(() => {
      if (!authenticatedClients.has(ws) && ws.readyState === WebSocket.OPEN) {
        console.warn(`[ws] closing unauthenticated client from ${peer} (auth timeout)`);
        ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized: authentication timeout');
      }
    }, WS_AUTH_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (!authenticatedClients.has(ws)) {
        clearTimeout(authTimer);
        if (isBinary) {
          console.warn(`[ws] rejected binary pre-auth payload from ${peer}`);
          ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized: PIN authentication required');
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString('utf8'));
        } catch {
          parsed = null;
        }

        const record =
          parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null;
        const candidatePin =
          record && record.type === 'auth' && typeof record.pin === 'string'
            ? record.pin.trim()
            : '';

        if (!candidatePin || !isValidPinMatch(candidatePin, wsPin)) {
          console.warn(`[ws] rejected unauthorized client from ${peer} (invalid or missing PIN)`);
          ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized: invalid or missing PIN');
          return;
        }

        authenticatedClients.add(ws);
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        console.log(
          `[ws] client authenticated from ${peer} (authenticated: ${authenticatedClients.size})`,
        );
        return;
      }

      let relayed = 0;
      for (const client of authenticatedClients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
          relayed++;
        }
      }
      const byteLen = Buffer.isBuffer(data)
        ? data.length
        : Array.isArray(data)
          ? data.reduce((sum, b) => sum + b.length, 0)
          : (data as ArrayBuffer).byteLength;
      console.log(
        `[ws] relayed ${isBinary ? 'binary' : 'text'} message (${byteLen} bytes) to ${relayed} authenticated client(s)`,
      );
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      authenticatedClients.delete(ws);
      console.log(
        `[ws] client disconnected (authenticated: ${authenticatedClients.size})`,
      );
    });
    ws.on('error', (err) => console.error('[ws] error:', err.message));
  });

  const distPath = path.resolve(serverDir, 'dist');
  const mobileDistPath = path.resolve(serverDir, 'mobile', 'dist');

  // Serve the built Mobile Companion App at /mobile
  app.use('/mobile', express.static(mobileDistPath));
  app.get(['/mobile', '/mobile/*'], (_req: Request, res: Response) => {
    res.sendFile(path.join(mobileDistPath, 'index.html'));
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.on('upgrade', (req, socket, head) => {
    const protocol = req.headers['sec-websocket-protocol'];
    // Let Vite HMR handle its own WebSocket upgrades without interference.
    if (typeof protocol === 'string' && protocol.includes('vite-hmr')) {
      return;
    }

    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/sync') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  });

  httpServer.listen(port, host, () => {
    console.log(`Trace | OSINT Canvas listening on http://${host}:${port}`);
    console.log(`Mobile Companion App available at http://${host}:${port}/mobile`);
    console.log(`WebSocket sync endpoint: ws://${host}:${port}/sync`);
    console.log(`🔒 WebSocket PIN: ${wsPin}`);
    console.log(`Projects data directory: ${dataDir}`);
    console.log(`CORS origins: ${allowedOrigins.join(', ')}`);
    console.log(
      `OSINT pivot engine: native fetch (${OSINT_PLATFORMS.length} platforms, ${osintTimeoutMs}ms timeout)`,
    );
  });
}

void startServer();
