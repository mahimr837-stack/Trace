import { useEffect, useState } from 'react';
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Settings,
  X,
} from 'lucide-react';
import { useCanvasStore } from '../store/useCanvasStore';
import {
  readGlobalSettings,
  saveGlobalSettings,
  type ProviderConfigEntry,
} from '../utils/globalSettings';
import {
  getProviderMeta,
  isVisionCapableModel,
  LLM_PROVIDERS,
  NON_VISION_MODEL_WARNING,
  normalizeProviderModel,
  type LlmProviderId,
} from '../utils/llmProviders';

export interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function GlobalSettingsDialogContent({ onClose }: { onClose: () => void }) {
  const setModelConfig = useCanvasStore((state) => state.setModelConfig);
  const setShodanApiKey = useCanvasStore((state) => state.setShodanApiKey);

  const initialGlobal = readGlobalSettings();
  const [selectedProvider, setSelectedProvider] = useState<LlmProviderId>(
    initialGlobal.provider,
  );
  const [draftConfigs, setDraftConfigs] = useState<
    Record<LlmProviderId, ProviderConfigEntry>
  >(() => initialGlobal.providerConfigs);
  const [shodanKeyDraft, setShodanKeyDraft] = useState<string>(
    initialGlobal.shodanApiKey,
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [showShodanKey, setShowShodanKey] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const currentMeta = getProviderMeta(selectedProvider);
  const currentDraft = draftConfigs[selectedProvider] ?? {
    apiKey: '',
    model: currentMeta.defaultModel,
  };
  const resolvedModel = normalizeProviderModel(
    selectedProvider,
    currentDraft.model,
  );
  const hasKeyConfigured = Boolean(currentDraft.apiKey.trim());
  const supportsVisionForDraft = isVisionCapableModel(
    selectedProvider,
    currentDraft.model.trim() || resolvedModel,
  );

  const updateCurrentDraft = (patch: Partial<ProviderConfigEntry>) => {
    setDraftConfigs((prev) => ({
      ...prev,
      [selectedProvider]: {
        ...(prev[selectedProvider] ?? {
          apiKey: '',
          model: currentMeta.defaultModel,
        }),
        ...patch,
      },
    }));
  };

  const handleSave = () => {
    const trimmedKey = currentDraft.apiKey.trim();
    const trimmedShodanKey = shodanKeyDraft.trim();
    const updatedConfigs: Record<LlmProviderId, ProviderConfigEntry> = {
      ...draftConfigs,
      [selectedProvider]: {
        apiKey: trimmedKey,
        model: resolvedModel,
      },
    };

    saveGlobalSettings({
      provider: selectedProvider,
      apiKey: trimmedKey,
      model: resolvedModel,
      shodanApiKey: trimmedShodanKey,
      providerConfigs: updatedConfigs,
    });

    setModelConfig({
      provider: selectedProvider,
      apiKey: trimmedKey,
      model: resolvedModel,
    });
    setShodanApiKey(trimmedShodanKey);

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/35 p-4 backdrop-blur-[1px]"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-settings-title"
        data-testid="global-settings-modal"
        className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl"
      >
        {/* Compact Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[#ff4d4d]" />
            <h2
              id="global-settings-title"
              className="text-sm font-semibold text-neutral-900"
            >
              Global Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Global Settings modal"
            data-testid="close-global-settings-btn"
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Clean, Minimal Configuration Form */}
        <div className="space-y-3.5 p-4">
          {/* 1. Provider Dropdown */}
          <div>
            <label
              htmlFor="global-provider-select"
              className="mb-1.5 block text-xs font-medium text-neutral-700"
            >
              AI Provider
            </label>
            <select
              id="global-provider-select"
              data-testid="global-provider-select"
              value={selectedProvider}
              onChange={(e) =>
                setSelectedProvider(e.target.value as LlmProviderId)
              }
              className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-900 focus:border-neutral-400 focus:outline-none"
            >
              {LLM_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          {/* 2. API Key Input + Console Link */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="global-api-key-input"
                className="text-xs font-medium text-neutral-700"
              >
                API Key ({currentMeta.name})
              </label>
              <a
                href={currentMeta.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="get-api-key-link"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#ff4d4d] transition-colors hover:text-red-700 focus-visible:outline-none focus-visible:underline"
              >
                <span>Get API Key</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
            <div className="relative flex items-center">
              <KeyRound className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-neutral-400" />
              <input
                id="global-api-key-input"
                data-testid="global-api-key-input"
                type={showApiKey ? 'text' : 'password'}
                value={currentDraft.apiKey}
                onChange={(e) => updateCurrentDraft({ apiKey: e.target.value })}
                placeholder={`Enter ${currentMeta.name} API key (${currentMeta.envVarName})...`}
                autoComplete="off"
                spellCheck={false}
                className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 pl-8 pr-8 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((prev) => !prev)}
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                data-testid="toggle-api-key-visibility-btn"
                className="absolute right-2 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none"
              >
                {showApiKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">
              Saved globally in browser storage across all investigations.
            </p>
          </div>

          {/* 3. Model Identifier + Preset Model Selector */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="global-model-custom"
                className="text-xs font-medium text-neutral-700"
              >
                Model Identifier
              </label>
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="global-model-select"
                  className="text-[11px] text-neutral-400"
                >
                  Preset
                </label>
                <select
                  id="global-model-select"
                  data-testid="global-model-select"
                  aria-label="Preset Model"
                  value={
                    currentMeta.models.includes(resolvedModel)
                      ? resolvedModel
                      : selectedProvider === 'google'
                        ? currentMeta.defaultModel
                        : '__custom__'
                  }
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      updateCurrentDraft({ model: e.target.value });
                    }
                  }}
                  className="max-w-44 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-medium text-neutral-700 focus:border-neutral-400 focus:bg-white focus:outline-none"
                >
                  {currentMeta.models.map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                  {selectedProvider !== 'google' &&
                    !currentMeta.models.includes(currentDraft.model) && (
                      <option value="__custom__">Custom</option>
                    )}
                </select>
              </div>
            </div>
            <input
              id="global-model-custom"
              data-testid="global-model-custom-input"
              type="text"
              value={
                selectedProvider === 'google' ? resolvedModel : currentDraft.model
              }
              onChange={(e) => updateCurrentDraft({ model: e.target.value })}
              placeholder={currentMeta.defaultModel}
              spellCheck={false}
              className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
            />
            {!supportsVisionForDraft && (
              <p
                role="alert"
                data-testid="non-vision-model-warning"
                className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800"
              >
                {NON_VISION_MODEL_WARNING}
              </p>
            )}
          </div>

          {/* 4. Shodan API Key (OSINT Infrastructure Lookup) */}
          <div className="border-t border-neutral-100 pt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="global-shodan-key-input"
                className="text-xs font-medium text-neutral-700"
              >
                Shodan API Key
              </label>
              <a
                href="https://account.shodan.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#ff4d4d] transition-colors hover:text-red-700 focus-visible:outline-none focus-visible:underline"
              >
                <span>Get Shodan Key</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
            <div className="relative flex items-center">
              <KeyRound className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-neutral-400" />
              <input
                id="global-shodan-key-input"
                data-testid="global-shodan-key-input"
                type={showShodanKey ? 'text' : 'password'}
                value={shodanKeyDraft}
                onChange={(e) => setShodanKeyDraft(e.target.value)}
                placeholder="Enter Shodan API key (SHODAN_API_KEY)..."
                autoComplete="off"
                spellCheck={false}
                className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 pl-8 pr-8 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowShodanKey((prev) => !prev)}
                aria-label={showShodanKey ? 'Hide Shodan API key' : 'Show Shodan API key'}
                data-testid="toggle-shodan-key-visibility-btn"
                className="absolute right-2 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none"
              >
                {showShodanKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">
              Used by ShodanNode for IP &amp; host reconnaissance via local proxy.
            </p>
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-neutral-100 bg-neutral-50/60 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                hasKeyConfigured ? 'bg-emerald-500' : 'bg-neutral-300'
              }`}
              aria-hidden="true"
            />
            <span
              data-testid="global-settings-summary"
              className="font-mono-tabular truncate text-[11px] text-neutral-500"
            >
              {currentMeta.name} ({resolvedModel})
            </span>
          </div>
          <button
            type="button"
            data-testid="save-global-settings-btn"
            onClick={handleSave}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer"
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
