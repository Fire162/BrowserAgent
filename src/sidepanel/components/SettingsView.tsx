import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Key, ExternalLink, RefreshCw, Cpu, Check, AlertCircle, Sparkles, Globe } from 'lucide-react';
import { AllSettings, ProviderId, ModelOption } from '../../core/llm/types';
import { PROVIDERS } from '../../core/llm/providers/registry';
import { fetchLiveProviderModels } from '../../core/llm/models-fetcher';

interface SettingsViewProps {
  settings: AllSettings;
  onSetActiveProvider: (id: ProviderId) => void;
  onUpdateProvider: (id: ProviderId, updates: Partial<AllSettings['providers'][ProviderId]>) => void;
  onUpdateAgent: (updates: Partial<AllSettings['agent']>) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSetActiveProvider,
  onUpdateProvider,
  onUpdateAgent,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [liveModelsMap, setLiveModelsMap] = useState<Partial<Record<ProviderId, ModelOption[]>>>({});
  const [modelFilter, setModelFilter] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);

  const activeProviderId = settings.activeProvider;
  const activeDef = PROVIDERS[activeProviderId];
  const activeConfig = settings.providers[activeProviderId];

  // Auto-fetch OpenRouter models live on load or provider switch
  useEffect(() => {
    if (activeProviderId === 'openrouter' && !liveModelsMap['openrouter']) {
      fetchLiveProviderModels('openrouter', activeConfig.apiKey || '')
        .then((models) => {
          if (models.length > 0) {
            setLiveModelsMap((prev) => ({ ...prev, openrouter: models }));
          }
        })
        .catch(() => {});
    }
  }, [activeProviderId]);

  const handleFetchLiveModels = async () => {
    if (activeDef.requiresApiKey && activeProviderId !== 'openrouter' && !activeConfig.apiKey?.trim()) {
      alert(`Please enter your ${activeDef.name} API key first.`);
      return;
    }

    setFetchingModels(true);
    setFetchMessage(null);

    try {
      const models = await fetchLiveProviderModels(
        activeProviderId,
        activeConfig.apiKey,
        activeConfig.baseUrl
      );

      if (models.length > 0) {
        setLiveModelsMap((prev) => ({ ...prev, [activeProviderId]: models }));
        setFetchMessage(`Loaded ${models.length} live models directly from ${activeDef.name} API!`);
        setTimeout(() => setFetchMessage(null), 3000);
      } else {
        alert('Endpoint returned 0 models. Check your network or API key.');
      }
    } catch (err: any) {
      alert(`Error fetching models from ${activeDef.name}: ${err.message}`);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleApiKeyChange = (val: string) => {
    onUpdateProvider(activeProviderId, { apiKey: val.trim() });
    triggerSaveIndicator();
  };

  const handleModelChange = (modelId: string) => {
    onUpdateProvider(activeProviderId, { selectedModel: modelId, customModelId: '' });
    triggerSaveIndicator();
  };

  const handleCustomModelChange = (val: string) => {
    onUpdateProvider(activeProviderId, { customModelId: val });
    triggerSaveIndicator();
  };

  const handleBaseUrlChange = (val: string) => {
    onUpdateProvider(activeProviderId, { baseUrl: val.trim() });
    triggerSaveIndicator();
  };

  const triggerSaveIndicator = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 1500);
  };

  const availableModels = liveModelsMap[activeProviderId] || activeDef.models;

  const displayedModels = availableModels.filter(
    (m) =>
      m.name.toLowerCase().includes(modelFilter.toLowerCase()) ||
      m.id.toLowerCase().includes(modelFilter.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 text-sm text-slate-200">
      {/* Top Save Confirmation */}
      {saveSuccess && (
        <div className="fixed top-14 right-4 z-50 flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs rounded-full shadow-lg backdrop-blur animate-fade-in">
          <Check className="h-3.5 w-3.5" />
          <span>Settings saved</span>
        </div>
      )}

      {/* Provider Selector */}
      <section className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
          Select AI Provider
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(PROVIDERS) as ProviderId[]).map((pid) => {
            const p = PROVIDERS[pid];
            const isSelected = activeProviderId === pid;
            const hasKey = !p.requiresApiKey || Boolean(settings.providers[pid]?.apiKey);

            return (
              <button
                key={pid}
                onClick={() => {
                  onSetActiveProvider(pid);
                  setModelFilter('');
                }}
                className={`p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
                  isSelected
                    ? 'border-sky-500 bg-sky-500/10 shadow-sm'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`font-medium text-xs ${isSelected ? 'text-sky-300' : 'text-slate-200'}`}>
                    {p.name}
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      hasKey ? 'bg-emerald-400' : 'bg-amber-400/80'
                    }`}
                    title={hasKey ? 'Configured' : 'Key required'}
                  />
                </div>
                <span className="text-[10px] text-slate-400 line-clamp-1">{p.id}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Provider Configuration Card */}
      <section className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div>
            <h3 className="font-semibold text-white text-sm flex items-center gap-1.5">
              <span>{activeDef.name}</span>
              {activeProviderId === 'openrouter' && (
                <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1 rounded">
                  Live API Hub
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">{activeDef.description}</p>
          </div>
          {activeDef.requiresApiKey && (
            <a
              href={activeDef.apiKeyHelpUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 shrink-0 ml-2"
            >
              <span>Get Key</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* API Key */}
        {activeDef.requiresApiKey && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5 text-slate-400" />
              <span>API Key</span>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={activeConfig.apiKey || ''}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder={`Paste your ${activeDef.name} API key...`}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {!activeConfig.apiKey && (
              <p className="text-[11px] text-amber-400/90 flex items-center gap-1 mt-1">
                <AlertCircle className="h-3 w-3" />
                <span>An API key is required to run tasks with this provider.</span>
              </p>
            )}
          </div>
        )}

        {/* Custom Base URL (if custom or user wants proxy) */}
        {(activeProviderId === 'custom' || activeDef.defaultBaseUrl) && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-slate-400" />
              <span>API Base URL</span>
            </label>
            <input
              type="text"
              value={activeConfig.baseUrl || activeDef.defaultBaseUrl || ''}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder="https://..."
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>
        )}

        {/* Model Selection with LIVE Fetcher */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-sky-400" />
              <span>Model Selection</span>
            </label>
            <button
              type="button"
              onClick={handleFetchLiveModels}
              disabled={fetchingModels}
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 disabled:opacity-50 font-medium"
              title="Query the live provider endpoint for active serving models"
            >
              <RefreshCw className={`h-3 w-3 ${fetchingModels ? 'animate-spin' : ''}`} />
              <span>{fetchingModels ? 'Fetching...' : 'Refresh Live Models'}</span>
            </button>
          </div>

          {fetchMessage && (
            <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
              {fetchMessage}
            </div>
          )}

          {/* Model Search/Filter */}
          <div className="relative">
            <input
              type="text"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              placeholder={`Filter ${availableModels.length} models (e.g. 2.0, flash, sonnet, r1)...`}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Model Options List */}
          <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 border border-slate-800/80 rounded-lg p-1.5 bg-slate-950/40">
            {displayedModels.length === 0 ? (
              <div className="text-center py-4 text-slate-500 text-xs">
                No matching models found. Try clearing filter or refreshing.
              </div>
            ) : (
              displayedModels.map((m) => {
                const isSelected =
                  !activeConfig.customModelId &&
                  (activeConfig.selectedModel === m.id ||
                    (!activeConfig.selectedModel && activeDef.defaultModel === m.id));

                return (
                  <div
                    key={m.id}
                    onClick={() => handleModelChange(m.id)}
                    className={`p-2 rounded-md cursor-pointer transition-all flex items-start justify-between ${
                      isSelected
                        ? 'bg-sky-500/15 border border-sky-500/30 text-white'
                        : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-xs truncate">{m.name}</span>
                        {m.recommended && (
                          <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1 rounded">
                            Recommended
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5 font-mono">
                        {m.id}
                      </div>
                      {m.description && (
                        <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{m.description}</p>
                      )}
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />}
                  </div>
                );
              })
            )}
          </div>

          {/* Custom Model ID Override */}
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Or enter exact custom Model ID:</span>
              {activeConfig.customModelId && (
                <span className="text-sky-400 font-mono text-[10px]">Active</span>
              )}
            </div>
            <input
              type="text"
              value={activeConfig.customModelId || ''}
              onChange={(e) => handleCustomModelChange(e.target.value)}
              placeholder="e.g. gemini-2.0-flash, anthropic/claude-3-7-sonnet:thinking, etc."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>
      </section>

      {/* Agent Tuning Preferences */}
      <section className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-4">
        <h3 className="font-semibold text-white text-sm">Agent Settings</h3>

        {/* Max Steps */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300">Max Steps per Task</span>
            <span className="font-mono text-sky-400">{settings.agent.maxSteps} steps</span>
          </div>
          <input
            type="range"
            min="5"
            max="50"
            step="1"
            value={settings.agent.maxSteps}
            onChange={(e) => onUpdateAgent({ maxSteps: parseInt(e.target.value, 10) })}
            className="w-full accent-sky-500 cursor-pointer"
          />
        </div>

        {/* Temperature */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300">Sampling Temperature</span>
            <span className="font-mono text-sky-400">{settings.agent.temperature}</span>
          </div>
          <input
            type="range"
            min="0.0"
            max="1.0"
            step="0.05"
            value={settings.agent.temperature}
            onChange={(e) => onUpdateAgent({ temperature: parseFloat(e.target.value) })}
            className="w-full accent-sky-500 cursor-pointer"
          />
        </div>

        {/* Visual Element Badges Toggle */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <div className="text-xs font-medium text-slate-200">Show Element Badges</div>
            <div className="text-[11px] text-slate-400">Displays high-contrast numeric tags on interactive elements</div>
          </div>
          <button
            type="button"
            onClick={() => onUpdateAgent({ showVisualLabels: !settings.agent.showVisualLabels })}
            className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors ${
              settings.agent.showVisualLabels ? 'bg-sky-500' : 'bg-slate-800'
            }`}
          >
            <div
              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                settings.agent.showVisualLabels ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </section>
    </div>
  );
};
