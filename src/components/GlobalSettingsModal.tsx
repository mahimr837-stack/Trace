import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { useCanvasStore } from '../store/useCanvasStore';
import {
  inferLegacyProviderIdFromCustom,
  normalizeBaseUrl,
  readGlobalSettings,
  saveCustomProviders,
  type AvailableModelOption,
  type CustomProviderConfig,
  type CustomProviderType,
} from '../utils/globalSettings';
import {
  fetchProviderModels,
  isVisionCapableModel,
  NON_VISION_MODEL_WARNING,
} from '../utils/llmProviders';

export interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProviderFormState {
  editingId: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  providerType: CustomProviderType;
}

const EMPTY_FORM: ProviderFormState = {
  editingId: null,
  name: '',
  baseUrl: '',
  apiKey: '',
  providerType: 'openai',
};

function GlobalSettingsDialogContent({ onClose }: { onClose: () => void }) {
  const setModelConfig = useCanvasStore((state) => state.setModelConfig);
  const setShodanApiKey = useCanvasStore((state) => state.setShodanApiKey);

  const initialGlobal = readGlobalSettings();
  const [providers, setProviders] = useState<CustomProviderConfig[]>(
    () => initialGlobal.customProviders,
  );
  const [activeProviderId, setActiveProviderId] = useState<string | null>(
    () =>
      initialGlobal.activeCustomProviderId ??
      initialGlobal.customProviders[0]?.id ??
      null,
  );
  const [shodanKeyDraft, setShodanKeyDraft] = useState<string>(
    initialGlobal.shodanApiKey,
  );
  const [showFormApiKey, setShowFormApiKey] = useState(false);
  const [showShodanKey, setShowShodanKey] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState<boolean>(
    () => initialGlobal.customProviders.length === 0,
  );
  const [formState, setFormState] = useState<ProviderFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const [availableModels, setAvailableModels] = useState<AvailableModelOption[]>(
    [],
  );
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) ?? null,
    [activeProviderId, providers],
  );

  const syncToStoreAndStorage = useCallback(
    (
      nextProviders: CustomProviderConfig[],
      nextActiveId: string | null,
      nextShodanKey: string,
    ) => {
      const saved = saveCustomProviders({
        customProviders: nextProviders,
        activeCustomProviderId: nextActiveId,
        shodanApiKey: nextShodanKey,
      });
      setModelConfig({
        provider: saved.provider,
        apiKey: saved.apiKey,
        model: saved.model,
      });
      setShodanApiKey(saved.shodanApiKey);
    },
    [setModelConfig, setShodanApiKey],
  );

  const loadModelsForProvider = useCallback(
    async (provider: CustomProviderConfig) => {
      setIsFetchingModels(true);
      setModelsError(null);
      try {
        const models = await fetchProviderModels({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          providerType: provider.providerType,
        });
        setAvailableModels(models);

        // If this provider has no selected model yet, auto-select the first available model
        if (!provider.model && models.length > 0) {
          const firstModelId = models[0].id;
          setProviders((prev) => {
            const next = prev.map((p) =>
              p.id === provider.id ? { ...p, model: firstModelId } : p,
            );
            syncToStoreAndStorage(next, provider.id, shodanKeyDraft);
            return next;
          });
        }
      } catch (error) {
        setAvailableModels([]);
        setModelsError(
          error instanceof Error ? error.message : 'Failed to load models.',
        );
      } finally {
        setIsFetchingModels(false);
      }
    },
    [shodanKeyDraft, syncToStoreAndStorage],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Fetch models automatically whenever the selected provider changes
  useEffect(() => {
    if (!activeProvider) {
      setAvailableModels([]);
      setModelsError(null);
      return;
    }
    setSearchQuery('');
    void loadModelsForProvider(activeProvider);
  }, [
    activeProvider?.id,
    activeProvider?.baseUrl,
    activeProvider?.apiKey,
    activeProvider?.providerType,
  ]);

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableModels;
    return availableModels.filter(
      (m) =>
        m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [availableModels, searchQuery]);

  const handleOpenAddForm = () => {
    setFormState(EMPTY_FORM);
    setFormError(null);
    setShowFormApiKey(false);
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (provider: CustomProviderConfig) => {
    setFormState({
      editingId: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      providerType: provider.providerType,
    });
    setFormError(null);
    setShowFormApiKey(false);
    setIsFormOpen(true);
  };

  const handleSubmitProviderForm = () => {
    const name = formState.name.trim();
    const baseUrl = normalizeBaseUrl(formState.baseUrl);
    const apiKey = formState.apiKey.trim();

    if (!name) {
      setFormError('Provider name is required.');
      return;
    }
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      setFormError('Enter a valid http:// or https:// Base URL.');
      return;
    }

    let nextProviders: CustomProviderConfig[];
    let nextActiveId: string;

    if (formState.editingId) {
      nextActiveId = formState.editingId;
      nextProviders = providers.map((p) =>
        p.id === formState.editingId
          ? {
              ...p,
              name,
              baseUrl,
              apiKey,
              providerType: formState.providerType,
            }
          : p,
      );
    } else {
      const newProvider: CustomProviderConfig = {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        baseUrl,
        apiKey,
        providerType: formState.providerType,
        model: '',
      };
      nextActiveId = newProvider.id;
      nextProviders = [...providers, newProvider];
    }

    setProviders(nextProviders);
    setActiveProviderId(nextActiveId);
    setIsFormOpen(false);
    setFormState(EMPTY_FORM);
    setFormError(null);
    syncToStoreAndStorage(nextProviders, nextActiveId, shodanKeyDraft);
  };

  const handleDeleteProvider = (providerId: string) => {
    const nextProviders = providers.filter((p) => p.id !== providerId);
    const nextActiveId =
      activeProviderId === providerId
        ? (nextProviders[0]?.id ?? null)
        : activeProviderId;
    setProviders(nextProviders);
    setActiveProviderId(nextActiveId);
    if (nextProviders.length === 0) {
      setIsFormOpen(true);
    }
    syncToStoreAndStorage(nextProviders, nextActiveId, shodanKeyDraft);
  };

  const handleSelectProvider = (providerId: string) => {
    setActiveProviderId(providerId);
    setIsFormOpen(false);
    setFormError(null);
    syncToStoreAndStorage(providers, providerId, shodanKeyDraft);
  };

  const handleSelectModel = (modelId: string) => {
    if (!activeProvider) return;
    const nextProviders = providers.map((p) =>
      p.id === activeProvider.id ? { ...p, model: modelId } : p,
    );
    setProviders(nextProviders);
    syncToStoreAndStorage(nextProviders, activeProvider.id, shodanKeyDraft);
  };

  const handleSaveAndClose = () => {
    syncToStoreAndStorage(providers, activeProviderId, shodanKeyDraft);
    onClose();
  };

  const supportsVision = activeProvider
    ? isVisionCapableModel(
        inferLegacyProviderIdFromCustom(activeProvider),
        activeProvider.model,
      )
    : true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleSaveAndClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-settings-title"
        data-testid="global-settings-modal"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950 text-gray-100 shadow-2xl"
      >
        {/* Minimal Dark Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-gray-400" />
            <h2
              id="global-settings-title"
              className="text-sm font-semibold tracking-tight text-gray-100"
            >
              Global Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={handleSaveAndClose}
            aria-label="Close Global Settings modal"
            data-testid="close-global-settings-btn"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-600 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Two-Pane Dark Configuration Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-gray-800 overflow-y-auto md:grid-cols-12 md:divide-x md:divide-y-0">
          {/* Left Pane: Custom Providers & Add/Edit Form */}
          <div className="flex flex-col justify-between gap-4 p-4 md:col-span-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium tracking-wide text-gray-400 uppercase">
                  Providers
                </span>
                <button
                  type="button"
                  onClick={handleOpenAddForm}
                  data-testid="add-custom-provider-btn"
                  className="inline-flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] font-medium text-gray-200 transition-colors hover:bg-gray-800 hover:text-white cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Custom Provider</span>
                </button>
              </div>

              {/* Saved Custom Providers List */}
              {providers.length > 0 && (
                <div
                  data-testid="custom-providers-list"
                  className="space-y-1.5"
                >
                  {providers.map((provider) => {
                    const isSelected = provider.id === activeProviderId;
                    return (
                      <div
                        key={provider.id}
                        data-testid={`custom-provider-item-${provider.id}`}
                        className={`group flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                          isSelected
                            ? 'border-gray-600 bg-gray-800/90 text-gray-100'
                            : 'border-gray-800 bg-gray-900/60 text-gray-300 hover:border-gray-700 hover:bg-gray-900'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectProvider(provider.id)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">
                              {provider.name}
                            </span>
                            <span className="shrink-0 rounded border border-gray-700 bg-gray-950 px-1 py-0.5 text-[9px] font-medium text-gray-400 uppercase">
                              {provider.providerType === 'anthropic'
                                ? 'Anthropic'
                                : 'OpenAI'}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-gray-500">
                            {provider.baseUrl}
                          </p>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditForm(provider)}
                            aria-label={`Edit ${provider.name}`}
                            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-700/70 hover:text-gray-200 cursor-pointer"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProvider(provider.id)}
                            aria-label={`Delete ${provider.name}`}
                            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-700/70 hover:text-gray-200 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inline Add / Edit Custom Provider Form */}
              {isFormOpen && (
                <div
                  data-testid="custom-provider-form"
                  className="space-y-2.5 rounded-lg border border-gray-800 bg-gray-900/80 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-gray-300">
                      {formState.editingId
                        ? 'Edit Provider'
                        : 'Add Custom Provider'}
                    </span>
                    {providers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsFormOpen(false);
                          setFormError(null);
                        }}
                        className="text-[11px] text-gray-500 hover:text-gray-300 cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="custom-provider-name"
                      className="mb-1 block text-[11px] font-medium text-gray-400"
                    >
                      Provider Name
                    </label>
                    <input
                      id="custom-provider-name"
                      data-testid="custom-provider-name-input"
                      type="text"
                      value={formState.name}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder="e.g., OpenRouter, Local Ollama"
                      className="w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="custom-provider-base-url"
                      className="mb-1 block text-[11px] font-medium text-gray-400"
                    >
                      Base URL
                    </label>
                    <input
                      id="custom-provider-base-url"
                      data-testid="custom-provider-baseurl-input"
                      type="url"
                      value={formState.baseUrl}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          baseUrl: e.target.value,
                        }))
                      }
                      placeholder="https://openrouter.ai/api/v1"
                      spellCheck={false}
                      className="w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="custom-provider-api-key"
                      className="mb-1 block text-[11px] font-medium text-gray-400"
                    >
                      API Key
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id="custom-provider-api-key"
                        data-testid="custom-provider-apikey-input"
                        type={showFormApiKey ? 'text' : 'password'}
                        value={formState.apiKey}
                        onChange={(e) =>
                          setFormState((prev) => ({
                            ...prev,
                            apiKey: e.target.value,
                          }))
                        }
                        placeholder="sk-... (optional for local Ollama)"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-md border border-gray-700 bg-gray-950 py-1.5 pl-2.5 pr-8 font-mono text-xs text-gray-100 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowFormApiKey((prev) => !prev)}
                        aria-label={
                          showFormApiKey ? 'Hide API key' : 'Show API key'
                        }
                        className="absolute right-1.5 rounded p-1 text-gray-500 hover:text-gray-300 cursor-pointer"
                      >
                        {showFormApiKey ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="custom-provider-type"
                      className="mb-1 block text-[11px] font-medium text-gray-400"
                    >
                      Provider Type
                    </label>
                    <select
                      id="custom-provider-type"
                      data-testid="custom-provider-type-select"
                      value={formState.providerType}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          providerType: e.target.value as CustomProviderType,
                        }))
                      }
                      className="w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 focus:border-gray-500 focus:outline-none"
                    >
                      <option value="openai">OpenAI-compatible</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>

                  {formError && (
                    <p
                      role="alert"
                      className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[11px] text-gray-300"
                    >
                      {formError}
                    </p>
                  )}

                  <button
                    type="button"
                    data-testid="submit-custom-provider-btn"
                    onClick={handleSubmitProviderForm}
                    className="w-full rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-950 transition-colors hover:bg-white cursor-pointer"
                  >
                    {formState.editingId ? 'Update Provider' : 'Save Provider'}
                  </button>
                </div>
              )}
            </div>

            {/* Compact Shodan Key Input */}
            <div className="border-t border-gray-800 pt-3">
              <label
                htmlFor="global-shodan-key-input"
                className="mb-1 block text-[11px] font-medium text-gray-400"
              >
                Shodan API Key (Optional)
              </label>
              <div className="relative flex items-center">
                <KeyRound className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-gray-500" />
                <input
                  id="global-shodan-key-input"
                  data-testid="global-shodan-key-input"
                  type={showShodanKey ? 'text' : 'password'}
                  value={shodanKeyDraft}
                  onChange={(e) => setShodanKeyDraft(e.target.value)}
                  placeholder="SHODAN_API_KEY"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-gray-800 bg-gray-900 py-1.5 pl-8 pr-8 font-mono text-xs text-gray-200 placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowShodanKey((prev) => !prev)}
                  aria-label={
                    showShodanKey
                      ? 'Hide Shodan API key'
                      : 'Show Shodan API key'
                  }
                  className="absolute right-1.5 rounded p-1 text-gray-500 hover:text-gray-300 cursor-pointer"
                >
                  {showShodanKey ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right Pane: Searchable Model Selection */}
          <div className="flex min-h-[320px] flex-col gap-3 p-4 md:col-span-7">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-xs font-medium tracking-wide text-gray-400 uppercase">
                  Models
                </span>
                {activeProvider && (
                  <p className="truncate font-mono text-[11px] text-gray-500">
                    {activeProvider.name} · {activeProvider.baseUrl}
                  </p>
                )}
              </div>
              {activeProvider && (
                <button
                  type="button"
                  onClick={() => void loadModelsForProvider(activeProvider)}
                  disabled={isFetchingModels}
                  data-testid="refresh-models-btn"
                  aria-label="Refresh models list"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-gray-100 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${isFetchingModels ? 'animate-spin' : ''}`}
                  />
                  <span>Refresh</span>
                </button>
              )}
            </div>

            {!activeProvider ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-gray-800 bg-gray-900/40 p-6 text-center">
                <Server className="mb-2 h-5 w-5 text-gray-600" />
                <p className="text-xs font-medium text-gray-300">
                  No provider selected
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  Add a custom OpenAI-compatible or Anthropic provider to browse
                  and select available models.
                </p>
              </div>
            ) : (
              <>
                {/* Search Bar */}
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-gray-500" />
                  <input
                    type="search"
                    data-testid="model-search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search models by name or ID..."
                    aria-label="Search available models"
                    className="w-full rounded-lg border border-gray-800 bg-gray-900 py-2 pl-8 pr-3 text-xs text-gray-100 placeholder:text-gray-500 focus:border-gray-600 focus:outline-none"
                  />
                </div>

                {/* Searchable Model List */}
                <div
                  data-testid="models-list-container"
                  className="min-h-[200px] max-h-64 flex-1 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/50"
                >
                  {isFetchingModels ? (
                    <div className="flex h-48 items-center justify-center gap-2 text-xs text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                      <span>Fetching available models...</span>
                    </div>
                  ) : modelsError ? (
                    <div className="flex h-48 flex-col items-center justify-center gap-2 p-4 text-center">
                      <p className="max-w-xs text-xs text-gray-400">
                        {modelsError}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          void loadModelsForProvider(activeProvider)
                        }
                        className="rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-gray-200 hover:bg-gray-800 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  ) : filteredModels.length === 0 ? (
                    <div className="flex h-48 items-center justify-center p-4 text-center text-xs text-gray-500">
                      {availableModels.length === 0
                        ? 'No models returned by this endpoint.'
                        : 'No models match your search.'}
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-800/80">
                      {filteredModels.map((model) => {
                        const isSelected = activeProvider.model === model.id;
                        return (
                          <li key={model.id}>
                            <button
                              type="button"
                              onClick={() => handleSelectModel(model.id)}
                              data-testid={`model-option-${model.id}`}
                              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-gray-800 text-gray-100'
                                  : 'text-gray-300 hover:bg-gray-800/50 hover:text-gray-100'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">
                                  {model.name}
                                </p>
                                {model.name !== model.id && (
                                  <p className="truncate font-mono text-[10px] text-gray-500">
                                    {model.id}
                                  </p>
                                )}
                              </div>
                              {isSelected && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-gray-200" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Manual Model ID Input */}
                <div>
                  <label
                    htmlFor="global-model-custom"
                    className="mb-1 block text-[11px] font-medium text-gray-500"
                  >
                    Selected Model ID
                  </label>
                  <input
                    id="global-model-custom"
                    data-testid="global-model-custom-input"
                    type="text"
                    value={activeProvider.model}
                    onChange={(e) => handleSelectModel(e.target.value)}
                    placeholder="Select from list or type model ID..."
                    spellCheck={false}
                    className="w-full rounded-md border border-gray-800 bg-gray-900 px-2.5 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
                  />
                </div>

                {!supportsVision && activeProvider.model.trim() && (
                  <p
                    role="alert"
                    data-testid="non-vision-model-warning"
                    className="rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-gray-300"
                  >
                    {NON_VISION_MODEL_WARNING}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Minimal Dark Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-800 bg-gray-900/60 px-4 py-2.5">
          <span
            data-testid="global-settings-summary"
            className="truncate font-mono text-[11px] text-gray-400"
          >
            {activeProvider
              ? `${activeProvider.name} · ${activeProvider.model || 'No model selected'}`
              : 'No custom provider configured'}
          </span>
          <button
            type="button"
            data-testid="save-global-settings-btn"
            onClick={handleSaveAndClose}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gray-100 px-3.5 py-1.5 text-xs font-medium text-gray-950 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function GlobalSettingsModal({
  isOpen,
  onClose,
}: GlobalSettingsModalProps) {
  if (!isOpen) return null;
  return <GlobalSettingsDialogContent onClose={onClose} />;
}
