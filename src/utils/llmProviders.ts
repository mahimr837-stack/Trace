import type { ParsedInlineImage } from './osintGraph';
import {
  ApiAuthError,
  getGlobalApiKey,
  MISSING_API_KEY_CODE,
  MISSING_API_KEY_MESSAGE,
  readGlobalSettings,
} from './globalSettings';

export type LlmProviderId =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'deepseek'
  | 'mistral';

export interface LlmProviderMeta {
  id: LlmProviderId;
  name: string;
  envVarName: string;
  endpointLabel: string;
  endpointUrl: string | null;
  consoleUrl: string;
  defaultModel: string;
  models: readonly string[];
  keyPlaceholder: string;
  supportsVision: boolean;
  description: string;
}

export const LLM_PROVIDERS: readonly LlmProviderMeta[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    envVarName: 'ANTHROPIC_API_KEY',
    endpointLabel: '/api/llm/generate (api.anthropic.com)',
    endpointUrl: 'https://api.anthropic.com/v1/messages',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: [
      'claude-3-5-sonnet-latest',
      'claude-3-7-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest',
    ],
    keyPlaceholder: 'ANTHROPIC_API_KEY (Server Secret)',
    supportsVision: true,
    description: 'Server-proxied Anthropic Messages API with multimodal vision inspection.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envVarName: 'OPENAI_API_KEY',
    endpointLabel: '/api/llm/generate (api.openai.com)',
    endpointUrl: 'https://api.openai.com/v1/chat/completions',
    consoleUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
    keyPlaceholder: 'OPENAI_API_KEY (Server Secret)',
    supportsVision: true,
    description: 'Server-proxied OpenAI Chat Completions API with multimodal image understanding.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envVarName: 'OPENROUTER_API_KEY',
    endpointLabel: '/api/llm/generate (openrouter.ai)',
    endpointUrl: 'https://openrouter.ai/api/v1/chat/completions',
    consoleUrl: 'https://openrouter.ai/keys',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    models: [
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat',
    ],
    keyPlaceholder: 'OPENROUTER_API_KEY (Server Secret)',
    supportsVision: true,
    description:
      'Server-proxied OpenAI-compatible multi-model router supporting Claude, GPT-4o, Gemini, and DeepSeek.',
  },
  {
    id: 'google',
    name: 'Google',
    envVarName: 'GEMINI_API_KEY',
    endpointLabel: '/api/llm/generate (Gemini SDK)',
    endpointUrl: '/api/gemini/generate',
    consoleUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-1.5-flash',
    models: [
      'gemini-1.5-flash',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ],
    keyPlaceholder: 'GEMINI_API_KEY (Server Secret)',
    supportsVision: true,
    description: 'Server-side Google GenAI SDK for multimodal Gemini inspection.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    envVarName: 'DEEPSEEK_API_KEY',
    endpointLabel: '/api/llm/generate (api.deepseek.com)',
    endpointUrl: 'https://api.deepseek.com/chat/completions',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyPlaceholder: 'DEEPSEEK_API_KEY (Server Secret)',
    supportsVision: false,
    description:
      'Server-proxied DeepSeek reasoning API (processes text prompts, OCR, and EXIF context).',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    envVarName: 'MISTRAL_API_KEY',
    endpointLabel: '/api/llm/generate (api.mistral.ai)',
    endpointUrl: 'https://api.mistral.ai/v1/chat/completions',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    defaultModel: 'pixtral-large-latest',
    models: [
      'pixtral-large-latest',
      'pixtral-12b-2409',
      'mistral-large-latest',
      'mistral-small-latest',
    ],
    keyPlaceholder: 'MISTRAL_API_KEY (Server Secret)',
    supportsVision: true,
    description: 'Server-proxied Mistral API with Pixtral multimodal vision models.',
  },
] as const;

const LEGACY_GEMINI_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-4-argon',
  'gemini-3.1-flash-lite',
]);

export function normalizeProviderModel(
  providerId: LlmProviderId,
  model?: string | null,
): string {
  const meta = getProviderMeta(providerId);
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed) return meta.defaultModel;
  if (providerId === 'google' && LEGACY_GEMINI_MODELS.has(trimmed)) {
    return meta.defaultModel;
  }
  return trimmed;
}

export function getProviderMeta(providerId: LlmProviderId): LlmProviderMeta {
  const found = LLM_PROVIDERS.find((p) => p.id === providerId);
  return found ?? LLM_PROVIDERS[3];
}

export type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface OpenAiCompatibleRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: Array<{
      role: 'system' | 'user';
      content: string | OpenAiContentPart[];
    }>;
  };
}

/**
 * Builds an upstream OpenAI-compatible Chat Completions request for OpenAI, OpenRouter, DeepSeek, or Mistral.
 * Executed on the backend proxy server using server-side environment variable credentials.
 */
export function buildOpenAiCompatibleRequest(params: {
  provider: 'openai' | 'openrouter' | 'deepseek' | 'mistral';
  apiKey: string;
  model: string;
  promptText: string;
  images: ParsedInlineImage[];
  systemPrompt?: string;
  origin?: string;
}): OpenAiCompatibleRequestSpec {
  const { provider, apiKey, model, promptText, images, systemPrompt, origin } = params;
  const meta = getProviderMeta(provider);
  const url = meta.endpointUrl!;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey.trim()}`,
  };

  if (provider === 'openrouter') {
    if (origin) {
      headers['HTTP-Referer'] = origin;
    }
    headers['X-Title'] = 'Traceboard Image OSINT Canvas';
  }

  let content: string | OpenAiContentPart[];
  if (images.length > 0 && meta.supportsVision) {
    content = [
      { type: 'text', text: promptText },
      ...images.map((img) => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:${img.mimeType};base64,${img.data}`,
        },
      })),
    ];
  } else if (images.length > 0 && !meta.supportsVision) {
    content =
      `${promptText}\n\n` +
      `[Attachment note: ${images.length} image frame(s) were wired, but ${meta.name} text models inspect text, OCR, and EXIF metadata context rather than raw pixels.]`;
  } else {
    content = promptText;
  }

  const messages: OpenAiCompatibleRequestSpec['body']['messages'] = [];
  if (systemPrompt?.trim()) {
    messages.push({
      role: 'system',
      content: systemPrompt.trim(),
    });
  }
  messages.push({
    role: 'user',
    content,
  });

  return {
    url,
    headers,
    body: {
      model: model.trim() || meta.defaultModel,
      messages,
    },
  };
}

export type AnthropicContentPart =
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    }
  | {
      type: 'text';
      text: string;
    };

export interface AnthropicRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: Array<{
      role: 'user';
      content: AnthropicContentPart[];
    }>;
  };
}

/**
 * Builds an upstream Anthropic Messages API multimodal request.
 * Executed on the backend proxy server using server-side environment variable credentials.
 */
export function buildAnthropicRequest(params: {
  apiKey: string;
  model: string;
  promptText: string;
  images: ParsedInlineImage[];
  systemPrompt?: string;
}): AnthropicRequestSpec {
  const { apiKey, model, promptText, images, systemPrompt } = params;
  const meta = getProviderMeta('anthropic');

  const content: AnthropicContentPart[] = [
    ...images.map((img) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mimeType,
        data: img.data,
      },
    })),
    {
      type: 'text' as const,
      text: promptText,
    },
  ];

  const body: AnthropicRequestSpec['body'] = {
    model: model.trim() || meta.defaultModel,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  };

  if (systemPrompt?.trim()) {
    body.system = systemPrompt.trim();
  }

  return {
    url: meta.endpointUrl!,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
    },
    body,
  };
}

export function extractOpenAiResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as {
    message?: { content?: unknown };
  };
  const content = first?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          const textVal = (part as { text?: unknown }).text;
          return typeof textVal === 'string' ? textVal : '';
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

export function extractAnthropicResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        Boolean(block) &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export function readApiErrorMessage(payload: unknown, fallbackStatus: number): string {
  if (payload && typeof payload === 'object') {
    const rec = payload as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (typeof rec.error === 'string' && rec.error.trim()) return rec.error;
    if (
      rec.error &&
      typeof rec.error === 'object' &&
      typeof rec.error.message === 'string' &&
      rec.error.message.trim()
    ) {
      return rec.error.message;
    }
    if (typeof rec.message === 'string' && rec.message.trim()) {
      return rec.message;
    }
  }
  return `Provider request failed with HTTP ${fallbackStatus}.`;
}

export interface GeminiServerRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    promptText: string;
    images: ParsedInlineImage[];
    systemPrompt?: string;
    apiKey?: string;
  };
}

/**
 * Builds a server-side Gemini API proxy request payload.
 */
export function buildGeminiServerRequest(params: {
  model: string;
  promptText: string;
  images: ParsedInlineImage[];
  systemPrompt?: string;
  apiKey?: string;
}): GeminiServerRequestSpec {
  const meta = getProviderMeta('google');
  const resolvedModel = params.model.trim() || meta.defaultModel;
  const resolvedApiKey = params.apiKey?.trim() || getGlobalApiKey('google');
  return {
    url: '/api/gemini/generate',
    headers: {
      'Content-Type': 'application/json',
      ...(resolvedApiKey ? { 'x-api-key': resolvedApiKey } : {}),
    },
    body: {
      model: resolvedModel,
      promptText: params.promptText,
      images: params.images,
      ...(params.systemPrompt?.trim()
        ? { systemPrompt: params.systemPrompt.trim() }
        : {}),
      ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
    },
  };
}

export interface LlmProxyRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: {
    provider: LlmProviderId;
    model: string;
    promptText: string;
    images: ParsedInlineImage[];
    systemPrompt?: string;
    apiKey?: string;
  };
}

/**
 * Builds a unified server-side LLM proxy request payload for any provider
 * (Google Gemini, Anthropic, OpenAI, OpenRouter, DeepSeek, or Mistral).
 * Pulls the global API key from localStorage when available and forwards it
 * via both the `x-api-key` header and JSON body.
 */
export function buildLlmProxyRequest(params: {
  provider?: LlmProviderId;
  apiKey?: string;
  model?: string;
  promptText: string;
  images: ParsedInlineImage[];
  systemPrompt?: string;
}): LlmProxyRequestSpec {
  const globalSettings = readGlobalSettings();
  const resolvedProvider = params.provider ?? globalSettings.provider;
  const resolvedModel = normalizeProviderModel(
    resolvedProvider,
    params.model ?? globalSettings.model,
  );
  const resolvedApiKey =
    params.apiKey?.trim() || getGlobalApiKey(resolvedProvider);

  return {
    url: '/api/llm/generate',
    headers: {
      'Content-Type': 'application/json',
      ...(resolvedApiKey ? { 'x-api-key': resolvedApiKey } : {}),
    },
    body: {
      provider: resolvedProvider,
      model: resolvedModel,
      promptText: params.promptText,
      images: params.images,
      ...(params.systemPrompt?.trim()
        ? { systemPrompt: params.systemPrompt.trim() }
        : {}),
      ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
    },
  };
}

const CLIENT_AI_TIMEOUT_MS = 40_000;

/**
 * Executes a multimodal OSINT inspection request via the backend API proxy layer (`/api/llm/generate`).
 * Pulls the active provider, model, and API key from global localStorage settings.
 * If no client key is configured, the request is still sent so the server can fall back to `.env`,
 * or return HTTP 401 so the UI can prompt the user to configure Settings.
 */
export async function runMultiProviderAnalysis(params: {
  provider?: LlmProviderId;
  apiKey?: string;
  model?: string;
  promptText: string;
  images: ParsedInlineImage[];
  systemPrompt?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<string> {
  const globalSettings = readGlobalSettings();
  const provider = params.provider ?? globalSettings.provider;
  const meta = getProviderMeta(provider);
  const model = normalizeProviderModel(
    provider,
    params.model ?? globalSettings.model,
  );
  const resolvedApiKey = params.apiKey?.trim() || getGlobalApiKey(provider);

  const spec = buildLlmProxyRequest({
    provider,
    apiKey: resolvedApiKey || undefined,
    model,
    promptText: params.promptText,
    images: params.images,
    systemPrompt: params.systemPrompt,
  });

  const fetchFn = params.fetchImpl ?? fetch;
  const timeoutMs = params.timeoutMs ?? CLIENT_AI_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
      signal: controller.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (isAbort) {
      throw new Error(
        `${meta.name} request timed out after ${Math.round(timeoutMs / 1000)}s. Check your network or API key.`,
      );
    }
    throw new Error(
      error instanceof Error
        ? `Network error contacting backend: ${error.message}`
        : 'Network error contacting backend.',
    );
  } finally {
    clearTimeout(timer);
  }

  const rawText = await res.text().catch(() => '');
  let json: {
    text?: unknown;
    error?: unknown;
    message?: unknown;
    code?: unknown;
  } | null = null;
  if (rawText) {
    try {
      json = JSON.parse(rawText) as {
        text?: unknown;
        error?: unknown;
        message?: unknown;
        code?: unknown;
      };
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const errMsg =
      (json && readApiErrorMessage(json, res.status)) ||
      (rawText.trim() && !rawText.trim().startsWith('<')
        ? rawText.trim().slice(0, 300)
        : `Provider request failed with HTTP ${res.status}.`);
    if (res.status === 401) {
      const code =
        json && typeof json.code === 'string' && json.code.trim()
          ? json.code.trim()
          : MISSING_API_KEY_CODE;
      throw new ApiAuthError(errMsg || MISSING_API_KEY_MESSAGE, 401, code);
    }
    throw new Error(errMsg);
  }

  const text = json && typeof json.text === 'string' ? json.text.trim() : '';
  return text || `${meta.name} returned an empty response for this inspection.`;
}
