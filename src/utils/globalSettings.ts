import {
  getProviderMeta,
  LLM_PROVIDERS,
  normalizeProviderModel,
  type LlmProviderId,
} from './llmProviders';

export const GLOBAL_SETTINGS_STORAGE_KEY = 'traceboard_global_settings';
export const GLOBAL_PROVIDER_STORAGE_KEY = 'traceboard_provider';
export const GLOBAL_API_KEY_STORAGE_KEY = 'traceboard_api_key';
export const GLOBAL_MODEL_STORAGE_KEY = 'traceboard_model';
export const GLOBAL_SHODAN_KEY_STORAGE_KEY = 'traceboard_shodan_api_key';
export const GLOBAL_CUSTOM_PROVIDERS_STORAGE_KEY = 'traceboard_custom_providers';
export const GLOBAL_ACTIVE_CUSTOM_PROVIDER_ID_KEY =
  'traceboard_active_custom_provider_id';

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

export type CustomProviderType = 'openai' | 'anthropic';

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  providerType: CustomProviderType;
  model: string;
}

export interface AvailableModelOption {
  id: string;
  name: string;
}

export interface ProviderConfigEntry {
  apiKey: string;
  model: string;
}

export interface GlobalSettingsState {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  providerType: CustomProviderType;
  shodanApiKey: string;
  providerConfigs: Record<LlmProviderId, ProviderConfigEntry>;
  customProviders: CustomProviderConfig[];
  activeCustomProviderId: string | null;
}

function isValidProviderId(value: unknown): value is LlmProviderId {
  return (
    typeof value === 'string' &&
    LLM_PROVIDERS.some((provider) => provider.id === value)
  );
}

function isValidCustomProviderType(value: unknown): value is CustomProviderType {
  return value === 'openai' || value === 'anthropic';
}

export function normalizeBaseUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '');
}

export function inferLegacyProviderIdFromCustom(
  custom: Pick<CustomProviderConfig, 'baseUrl' | 'providerType'>,
): LlmProviderId {
  if (custom.providerType === 'anthropic') return 'anthropic';
  const lower = custom.baseUrl.toLowerCase();
  if (lower.includes('openrouter.ai')) return 'openrouter';
  if (lower.includes('deepseek.com')) return 'deepseek';
  if (lower.includes('mistral.ai')) return 'mistral';
  if (lower.includes('generativelanguage.googleapis.com')) return 'google';
  return 'openai';
}

function sanitizeCustomProvider(raw: unknown): CustomProviderConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Partial<CustomProviderConfig>;
  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : '';
  const name =
    typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : '';
  const baseUrl =
    typeof rec.baseUrl === 'string' ? normalizeBaseUrl(rec.baseUrl) : '';
  if (!id || !name || !baseUrl) return null;

  return {
    id,
    name,
    baseUrl,
    apiKey: typeof rec.apiKey === 'string' ? rec.apiKey.trim() : '',
    providerType: isValidCustomProviderType(rec.providerType)
      ? rec.providerType
      : 'openai',
    model: typeof rec.model === 'string' ? rec.model.trim() : '',
  };
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
 * Returns the currently selected custom provider configuration, if any.
 */
export function getActiveCustomProvider(
  settings?: GlobalSettingsState,
): CustomProviderConfig | null {
  const state = settings ?? readGlobalSettings();
  if (!state.activeCustomProviderId) return null;
  return (
    state.customProviders.find((p) => p.id === state.activeCustomProviderId) ??
    null
  );
}

/**
 * Reads the global AI provider, custom providers, model, API key, and Shodan API key from localStorage.
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
      baseUrl: '',
      providerType: 'openai',
      shodanApiKey: '',
      providerConfigs,
      customProviders: [],
      activeCustomProviderId: null,
    };
  }

  let activeProvider: LlmProviderId = defaultProvider;
  let activeApiKey = '';
  let activeModel = defaultMeta.defaultModel;
  let activeBaseUrl = '';
  let activeProviderType: CustomProviderType = 'openai';
  let shodanApiKey = '';
  let customProviders: CustomProviderConfig[] = [];
  let activeCustomProviderId: string | null = null;

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
        if (Array.isArray(parsed.customProviders)) {
          customProviders = parsed.customProviders
            .map(sanitizeCustomProvider)
            .filter((item): item is CustomProviderConfig => item !== null);
        }
        if (
          typeof parsed.activeCustomProviderId === 'string' &&
          parsed.activeCustomProviderId.trim()
        ) {
          activeCustomProviderId = parsed.activeCustomProviderId.trim();
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
                model: normalizeProviderModel(
                  p.id,
                  typeof entry.model === 'string' ? entry.model : p.defaultModel,
                ),
              };
            }
          }
        }
        const currentMeta = getProviderMeta(activeProvider);
        activeApiKey =
          typeof parsed.apiKey === 'string'
            ? parsed.apiKey.trim()
            : providerConfigs[activeProvider]?.apiKey ?? '';
        activeModel = normalizeProviderModel(
          activeProvider,
          typeof parsed.model === 'string' && parsed.model.trim()
            ? parsed.model.trim()
            : providerConfigs[activeProvider]?.model ||
              currentMeta.defaultModel,
        );
        if (typeof parsed.baseUrl === 'string') {
          activeBaseUrl = normalizeBaseUrl(parsed.baseUrl);
        }
        if (isValidCustomProviderType(parsed.providerType)) {
          activeProviderType = parsed.providerType;
        }

        providerConfigs[activeProvider] = {
          apiKey: activeApiKey,
          model: activeModel,
        };
      }
    }

    // Also hydrate custom providers from dedicated localStorage key if present
    const rawCustomJson = storage.getItem(GLOBAL_CUSTOM_PROVIDERS_STORAGE_KEY);
    if (rawCustomJson && customProviders.length === 0) {
      const parsedCustom = JSON.parse(rawCustomJson) as unknown;
      if (Array.isArray(parsedCustom)) {
        customProviders = parsedCustom
          .map(sanitizeCustomProvider)
          .filter((item): item is CustomProviderConfig => item !== null);
      }
    }

    const rawActiveCustomId = storage.getItem(
      GLOBAL_ACTIVE_CUSTOM_PROVIDER_ID_KEY,
    );
    if (
      typeof rawActiveCustomId === 'string' &&
      rawActiveCustomId.trim() &&
      !activeCustomProviderId
    ) {
      activeCustomProviderId = rawActiveCustomId.trim();
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
      activeModel = normalizeProviderModel(activeProvider, directModel);
      providerConfigs[activeProvider] = {
        ...providerConfigs[activeProvider],
        model: activeModel,
      };
    }
    const directShodanKey = storage.getItem(GLOBAL_SHODAN_KEY_STORAGE_KEY);
    if (
      typeof directShodanKey === 'string' &&
      directShodanKey.trim() &&
      !shodanApiKey
    ) {
      shodanApiKey = directShodanKey.trim();
    }
  } catch {
    // Fallback to defaults if JSON in localStorage is corrupted
  }

  // If an active custom provider exists, ensure active fields reflect it cleanly
  const matchedCustom = activeCustomProviderId
    ? customProviders.find((p) => p.id === activeCustomProviderId) ?? null
    : null;
  if (matchedCustom) {
    activeProvider = inferLegacyProviderIdFromCustom(matchedCustom);
    activeApiKey = matchedCustom.apiKey;
    activeModel = matchedCustom.model || activeModel;
    activeBaseUrl = matchedCustom.baseUrl;
    activeProviderType = matchedCustom.providerType;
  } else {
    activeCustomProviderId = null;
  }

  return {
    provider: activeProvider,
    apiKey: activeApiKey,
    model: activeModel,
    baseUrl: activeBaseUrl,
    providerType: activeProviderType,
    shodanApiKey,
    providerConfigs,
    customProviders,
    activeCustomProviderId,
  };
}

function persistGlobalSettingsState(nextState: GlobalSettingsState): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(GLOBAL_SETTINGS_STORAGE_KEY, JSON.stringify(nextState));
    storage.setItem(GLOBAL_PROVIDER_STORAGE_KEY, nextState.provider);
    storage.setItem(GLOBAL_API_KEY_STORAGE_KEY, nextState.apiKey);
    storage.setItem(GLOBAL_MODEL_STORAGE_KEY, nextState.model);
    storage.setItem(GLOBAL_SHODAN_KEY_STORAGE_KEY, nextState.shodanApiKey);
    storage.setItem(
      GLOBAL_CUSTOM_PROVIDERS_STORAGE_KEY,
      JSON.stringify(nextState.customProviders),
    );
    if (nextState.activeCustomProviderId) {
      storage.setItem(
        GLOBAL_ACTIVE_CUSTOM_PROVIDER_ID_KEY,
        nextState.activeCustomProviderId,
      );
    } else {
      storage.removeItem(GLOBAL_ACTIVE_CUSTOM_PROVIDER_ID_KEY);
    }
  } catch {
    // Ignore quota errors
  }
}

/**
 * Saves custom providers, active selection, and optional Shodan API key to localStorage.
 */
export function saveCustomProviders(input: {
  customProviders: CustomProviderConfig[];
  activeCustomProviderId: string | null;
  shodanApiKey?: string;
}): GlobalSettingsState {
  const current = readGlobalSettings();
  const sanitizedProviders = input.customProviders
    .map(sanitizeCustomProvider)
    .filter((item): item is CustomProviderConfig => item !== null);

  const activeCustom =
    (input.activeCustomProviderId
      ? sanitizedProviders.find((p) => p.id === input.activeCustomProviderId)
      : null) ??
    sanitizedProviders[0] ??
    null;

  const shodanApiKey =
    typeof input.shodanApiKey === 'string'
      ? input.shodanApiKey.trim()
      : current.shodanApiKey;

  const nextProvider = activeCustom
    ? inferLegacyProviderIdFromCustom(activeCustom)
    : current.provider;
  const nextApiKey = activeCustom ? activeCustom.apiKey : '';
  const nextModel = activeCustom
    ? activeCustom.model
    : current.model;
  const nextBaseUrl = activeCustom ? activeCustom.baseUrl : '';
  const nextProviderType: CustomProviderType = activeCustom
    ? activeCustom.providerType
    : 'openai';

  const nextProviderConfigs: Record<LlmProviderId, ProviderConfigEntry> = {
    ...current.providerConfigs,
    ...(activeCustom
      ? {
          [nextProvider]: {
            apiKey: nextApiKey,
            model: nextModel || getProviderMeta(nextProvider).defaultModel,
          },
        }
      : {}),
  };

  const nextState: GlobalSettingsState = {
    provider: nextProvider,
    apiKey: nextApiKey,
    model: nextModel,
    baseUrl: nextBaseUrl,
    providerType: nextProviderType,
    shodanApiKey,
    providerConfigs: nextProviderConfigs,
    customProviders: sanitizedProviders,
    activeCustomProviderId: activeCustom ? activeCustom.id : null,
  };

  persistGlobalSettingsState(nextState);
  return nextState;
}

/**
 * Saves the selected AI provider, API key, model, and optional Shodan API key globally to localStorage.
 */
export function saveGlobalSettings(input: {
  provider: LlmProviderId;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  providerType?: CustomProviderType;
  shodanApiKey?: string;
  providerConfigs?: Partial<Record<LlmProviderId, ProviderConfigEntry>>;
  customProviders?: CustomProviderConfig[];
  activeCustomProviderId?: string | null;
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

  const customProviders = Array.isArray(input.customProviders)
    ? input.customProviders
        .map(sanitizeCustomProvider)
        .filter((item): item is CustomProviderConfig => item !== null)
    : current.customProviders;

  const activeCustomProviderId =
    input.activeCustomProviderId !== undefined
      ? input.activeCustomProviderId
      : input.baseUrl !== undefined
        ? current.activeCustomProviderId
        : null;

  const baseUrl =
    typeof input.baseUrl === 'string'
      ? normalizeBaseUrl(input.baseUrl)
      : activeCustomProviderId
        ? current.baseUrl
        : '';
  const providerType: CustomProviderType = isValidCustomProviderType(
    input.providerType,
  )
    ? input.providerType
    : provider === 'anthropic'
      ? 'anthropic'
      : 'openai';

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
    baseUrl,
    providerType,
    shodanApiKey,
    providerConfigs: nextProviderConfigs,
    customProviders,
    activeCustomProviderId,
  };

  persistGlobalSettingsState(nextState);
  return nextState;
}

/**
 * Pulls the active API key from localStorage globally (optionally for a specific provider).
 */
export function getGlobalApiKey(provider?: LlmProviderId): string {
  const settings = readGlobalSettings();
  const activeCustom = getActiveCustomProvider(settings);
  if (activeCustom && !provider) {
    return activeCustom.apiKey.trim();
  }
  const targetProvider = provider ?? settings.provider;
  if (
    activeCustom &&
    inferLegacyProviderIdFromCustom(activeCustom) === targetProvider &&
    activeCustom.apiKey.trim()
  ) {
    return activeCustom.apiKey.trim();
  }
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
    baseUrl: current.baseUrl,
    providerType: current.providerType,
    shodanApiKey: shodanApiKey.trim(),
    providerConfigs: current.providerConfigs,
    customProviders: current.customProviders,
    activeCustomProviderId: current.activeCustomProviderId,
  });
}
