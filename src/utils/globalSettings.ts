import {
  getProviderMeta,
  LLM_PROVIDERS,
  type LlmProviderId,
} from './llmProviders';

export const GLOBAL_SETTINGS_STORAGE_KEY = 'traceboard_global_settings';
export const GLOBAL_PROVIDER_STORAGE_KEY = 'traceboard_provider';
export const GLOBAL_API_KEY_STORAGE_KEY = 'traceboard_api_key';
export const GLOBAL_MODEL_STORAGE_KEY = 'traceboard_model';
export const GLOBAL_SHODAN_KEY_STORAGE_KEY = 'traceboard_shodan_api_key';

export const MISSING_API_KEY_CODE = 'MISSING_API_KEY';
export const MISSING_API_KEY_MESSAGE =
  'Please set your API key in the Dashboard Settings.';
export const MISSING_SHODAN_KEY_MESSAGE =
  'Please set your Shodan API key in the Dashboard Settings (or in this node).';

export class ApiAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message = MISSING_API_KEY_MESSAGE,
    status = 401,
    code = MISSING_API_KEY_CODE,
  ) {
    super(message);
    this.name = 'ApiAuthError';
    this.status = status;
    this.code = code;
  }
}

export function isApiAuthError(error: unknown): error is ApiAuthError {
  return (
    error instanceof ApiAuthError ||
    (error instanceof Error &&
      'status' in error &&
      (error as { status?: unknown }).status === 401)
  );
}

export interface ProviderConfigEntry {
  apiKey: string;
  model: string;
}

export interface GlobalSettingsState {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  shodanApiKey: string;
  providerConfigs: Record<LlmProviderId, ProviderConfigEntry>;
}

function isValidProviderId(value: unknown): value is LlmProviderId {
  return (
    typeof value === 'string' &&
    LLM_PROVIDERS.some((provider) => provider.id === value)
  );
}

export function createDefaultProviderConfigs(): Record<
  LlmProviderId,
  ProviderConfigEntry
> {
  return Object.fromEntries(
    LLM_PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel }]),
  ) as Record<LlmProviderId, ProviderConfigEntry>;
}

function getSafeLocalStorage(): Storage | null {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      'localStorage' in globalThis &&
      globalThis.localStorage
    ) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return null;
}

/**
 * Reads the global AI provider, model, API key, and Shodan API key configuration from localStorage.
 */
export function readGlobalSettings(): GlobalSettingsState {
  const defaultProvider: LlmProviderId = 'google';
  const defaultMeta = getProviderMeta(defaultProvider);
  const providerConfigs = createDefaultProviderConfigs();

  const storage = getSafeLocalStorage();
  if (!storage) {
    return {
      provider: defaultProvider,
      apiKey: '',
      model: defaultMeta.defaultModel,
      shodanApiKey: '',
      providerConfigs,
    };
  }

  let activeProvider: LlmProviderId = defaultProvider;
  let activeApiKey = '';
  let activeModel = defaultMeta.defaultModel;
  let shodanApiKey = '';

  try {
    const rawJson = storage.getItem(GLOBAL_SETTINGS_STORAGE_KEY);
    if (rawJson) {
      const parsed = JSON.parse(rawJson) as Partial<GlobalSettingsState> | null;
      if (parsed && typeof parsed === 'object') {
        if (isValidProviderId(parsed.provider)) {
          activeProvider = parsed.provider;
        }
        if (typeof parsed.shodanApiKey === 'string') {
          shodanApiKey = parsed.shodanApiKey.trim();
        }
        if (
          parsed.providerConfigs &&
          typeof parsed.providerConfigs === 'object'
        ) {
          for (const p of LLM_PROVIDERS) {
            const entry = (
              parsed.providerConfigs as Partial<
                Record<LlmProviderId, Partial<ProviderConfigEntry>>
              >
            )[p.id];
            if (entry && typeof entry === 'object') {
              providerConfigs[p.id] = {
                apiKey:
                  typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '',
                model:
                  typeof entry.model === 'string' && entry.model.trim()
                    ? entry.model.trim()
                    : p.defaultModel,
              };
            }
          }
        }
        const currentMeta = getProviderMeta(activeProvider);
        activeApiKey =
          typeof parsed.apiKey === 'string'
            ? parsed.apiKey.trim()
            : providerConfigs[activeProvider]?.apiKey ?? '';
        activeModel =
          typeof parsed.model === 'string' && parsed.model.trim()
            ? parsed.model.trim()
            : providerConfigs[activeProvider]?.model ||
              currentMeta.defaultModel;

        providerConfigs[activeProvider] = {
          apiKey: activeApiKey,
          model: activeModel,
        };
      }
    }

    // Also allow direct scalar keys in localStorage to override or populate when present
    const directProvider = storage.getItem(GLOBAL_PROVIDER_STORAGE_KEY);
    if (directProvider && isValidProviderId(directProvider.trim())) {
      activeProvider = directProvider.trim() as LlmProviderId;
    }
    const directKey = storage.getItem(GLOBAL_API_KEY_STORAGE_KEY);
    if (typeof directKey === 'string' && directKey.trim() && !activeApiKey) {
      activeApiKey = directKey.trim();
      providerConfigs[activeProvider] = {
        ...providerConfigs[activeProvider],
        apiKey: activeApiKey,
      };
    }
    const directModel = storage.getItem(GLOBAL_MODEL_STORAGE_KEY);
    if (typeof directModel === 'string' && directModel.trim() && !rawJson) {
      activeModel = directModel.trim();
      providerConfigs[activeProvider] = {
        ...providerConfigs[activeProvider],
        model: activeModel,
      };
    }
    const directShodanKey = storage.getItem(GLOBAL_SHODAN_KEY_STORAGE_KEY);
    if (typeof directShodanKey === 'string' && directShodanKey.trim() && !shodanApiKey) {
      shodanApiKey = directShodanKey.trim();
    }
  } catch {
    // Fallback to defaults if JSON in localStorage is corrupted
  }

  return {
    provider: activeProvider,
    apiKey: activeApiKey,
    model: activeModel,
    shodanApiKey,
    providerConfigs,
  };
}

/**
 * Saves the selected AI provider, API key, model, and optional Shodan API key globally to localStorage.
 */
export function saveGlobalSettings(input: {
  provider: LlmProviderId;
  apiKey: string;
  model?: string;
  shodanApiKey?: string;
  providerConfigs?: Partial<Record<LlmProviderId, ProviderConfigEntry>>;
}): GlobalSettingsState {
  const current = readGlobalSettings();
  const provider = isValidProviderId(input.provider)
    ? input.provider
    : current.provider;
  const meta = getProviderMeta(provider);
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const model =
    typeof input.model === 'string' && input.model.trim()
      ? input.model.trim()
      : current.providerConfigs[provider]?.model || meta.defaultModel;
  const shodanApiKey =
    typeof input.shodanApiKey === 'string'
      ? input.shodanApiKey.trim()
      : current.shodanApiKey;

  const nextProviderConfigs: Record<LlmProviderId, ProviderConfigEntry> = {
    ...current.providerConfigs,
    ...(input.providerConfigs ?? {}),
    [provider]: {
      apiKey,
      model,
    },
  };

  const nextState: GlobalSettingsState = {
    provider,
    apiKey,
    model,
    shodanApiKey,
    providerConfigs: nextProviderConfigs,
  };

  const storage = getSafeLocalStorage();
  if (storage) {
    try {
      storage.setItem(GLOBAL_SETTINGS_STORAGE_KEY, JSON.stringify(nextState));
      storage.setItem(GLOBAL_PROVIDER_STORAGE_KEY, provider);
      storage.setItem(GLOBAL_API_KEY_STORAGE_KEY, apiKey);
      storage.setItem(GLOBAL_MODEL_STORAGE_KEY, model);
      storage.setItem(GLOBAL_SHODAN_KEY_STORAGE_KEY, shodanApiKey);
    } catch {
      // Ignore quota errors
    }
  }

  return nextState;
}

/**
 * Pulls the active API key from localStorage globally (optionally for a specific provider).
 */
export function getGlobalApiKey(provider?: LlmProviderId): string {
  const settings = readGlobalSettings();
  const targetProvider = provider ?? settings.provider;
  const providerKey = settings.providerConfigs[targetProvider]?.apiKey?.trim();
  if (providerKey) return providerKey;
  if (targetProvider === settings.provider && settings.apiKey.trim()) {
    return settings.apiKey.trim();
  }
  return '';
}

/**
 * Pulls the Shodan API key from localStorage globally.
 */
export function getGlobalShodanApiKey(): string {
  return readGlobalSettings().shodanApiKey.trim();
}

/**
 * Persists only the Shodan API key globally to localStorage without altering LLM provider settings.
 */
export function saveGlobalShodanApiKey(shodanApiKey: string): GlobalSettingsState {
  const current = readGlobalSettings();
  return saveGlobalSettings({
    provider: current.provider,
    apiKey: current.apiKey,
    model: current.model,
    shodanApiKey: shodanApiKey.trim(),
    providerConfigs: current.providerConfigs,
  });
}
