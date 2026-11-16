import React, { useState, useEffect } from 'react';
import {
  Eye,
  EyeOff,
  Key,
  ExternalLink,
  RefreshCw,
  Cpu,
  Check,
  AlertCircle,
  Sparkles,
  Layers,
  Plus,
  Trash2,
  Shuffle,
  RotateCw,
  ShieldAlert,
  ClipboardList,
} from 'lucide-react';
import { AllSettings, ProviderId, ModelOption, KeyRotationStrategy } from '../../core/llm/types';
import { PROVIDERS } from '../../core/llm/providers/registry';
import { fetchLiveProviderModels } from '../../core/llm/models-fetcher';
import { getProviderApiKeys, maskApiKey, normalizeApiKeys } from '../../core/llm/key-pool';

interface SettingsViewProps {
  settings: AllSettings;
  onSetActiveProvider: (id: ProviderId) => void;
  onUpdateProvider: (id: ProviderId, updates: Partial<AllSettings['providers'][ProviderId]>) => void;
  onUpdateAgent: (updates: Partial<AllSettings['agent']>) => void;
  warningBanner?: string | null;
  onClearWarning?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSetActiveProvider,
  onUpdateProvider,
  onUpdateAgent,
  warningBanner,
  onClearWarning,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [liveModelsMap, setLiveModelsMap] = useState<Partial<Record<ProviderId, ModelOption[]>>>({});
  const [modelFilter, setModelFilter] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Key Pool local input state
  const [newKeyInput, setNewKeyInput] = useState('');
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkInputText, setBulkInputText] = useState('');

  const activeProviderId = settings.activeProvider;
  const activeDef = PROVIDERS[activeProviderId];
  const activeConfig = settings.providers[activeProviderId];

  const currentKeys = getProviderApiKeys(activeConfig);
  const currentStrategy: KeyRotationStrategy = activeConfig.keyStrategy || 'use_until_error';

  // Sync bulk text input when active provider or current keys change
  useEffect(() => {
    setBulkInputText(currentKeys.join('\n'));
    setNewKeyInput('');
    setIsBulkEditing(false);
  }, [activeProviderId]);

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

  const triggerSaveIndicator = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 1500);
  };

  const handleFetchLiveModels = async () => {
    const keys = getProviderApiKeys(activeConfig);
    if (activeDef.requiresApiKey && activeProviderId !== 'openrouter' && keys.length === 0) {
      setErrorMessage(`Please enter your ${activeDef.name} API key first.`);
      setTimeout(() => setErrorMessage(null), 3500);
      return;
    }

    setFetchingModels(true);
    setFetchMessage(null);
    setErrorMessage(null);

    try {
      const primaryKey = keys[0] || activeConfig.apiKey;
      const models = await fetchLiveProviderModels(
        activeProviderId,
        primaryKey,
        activeConfig.baseUrl
      );

      if (models.length > 0) {
        setLiveModelsMap((prev) => ({ ...prev, [activeProviderId]: models }));
        setFetchMessage(`Loaded ${models.length} live models directly from ${activeDef.name} API!`);
        setTimeout(() => setFetchMessage(null), 3000);
      } else {
        setErrorMessage('Endpoint returned 0 models. Check your network or API key.');
        setTimeout(() => setErrorMessage(null), 3500);
      }
    } catch (err: any) {
      setErrorMessage(`Error fetching models from ${activeDef.name}: ${err.message}`);
      setTimeout(() => setErrorMessage(null), 4000);
    } finally {
      setFetchingModels(false);
    }
  };

  const updateKeys = (newKeys: string[]) => {
    const normalized = normalizeApiKeys(newKeys);
    onUpdateProvider(activeProviderId, {
      apiKeys: normalized,
      apiKey: normalized[0] || '',
    });
    setBulkInputText(normalized.join('\n'));
    triggerSaveIndicator();
  };

  const handleAddSingleKey = () => {
    const trimmed = newKeyInput.trim();
    if (!trimmed) return;
    const added = normalizeApiKeys([...currentKeys, trimmed]);
    updateKeys(added);
    setNewKeyInput('');
  };

  const handleRemoveKey = (idx: number) => {
    const updated = currentKeys.filter((_, i) => i !== idx);
    updateKeys(updated);
  };

  const handleSaveBulkKeys = () => {
    const parsed = normalizeApiKeys(bulkInputText);
    updateKeys(parsed);
    setIsBulkEditing(false);
  };

  const handleStrategyChange = (strat: KeyRotationStrategy) => {
    onUpdateProvider(activeProviderId, { keyStrategy: strat });
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

      {/* Warning Banner if redirected from Chat */}
      {warningBanner && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/35 rounded-xl text-amber-200 text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{warningBanner}</span>
          </div>
          {onClearWarning && (
            <button
              onClick={onClearWarning}
              className="text-amber-400 hover:text-white text-xs font-bold px-1 cursor-pointer"
            >
              ✕
            </button>
          )}
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
            const pKeys = getProviderApiKeys(settings.providers[pid]);
            const hasKey = !p.requiresApiKey || pKeys.length > 0;

            return (
              <button
                key={pid}
                onClick={() => {
                  onSetActiveProvider(pid);
                  setModelFilter('');
                }}
                className={`p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  isSelected
                    ? 'border-sky-500 bg-sky-500/10 shadow-sm'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`font-medium text-xs ${isSelected ? 'text-sky-300' : 'text-slate-200'}`}>
                    {p.name}
                  </span>
                  <div className="flex items-center gap-1">
                    {pKeys.length > 1 && (
                      <span className="text-[9px] px-1 bg-sky-500/20 text-sky-300 rounded font-mono">
                        {pKeys.length}x
                      </span>
                    )}
                    <span
                      className={`h-2 w-2 rounded-full ${
                        hasKey ? 'bg-emerald-400' : 'bg-amber-400/80'
                      }`}
                      title={hasKey ? `${pKeys.length || 1} Key(s) Configured` : 'Key required'}
                    />
                  </div>
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

        {/* Multi API Key Pool System */}
        {activeDef.requiresApiKey && (
          <div className="space-y-3 p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-sky-400" />
                <span className="text-xs font-semibold text-slate-200">API Key Pool</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300">
                  {currentKeys.length} {currentKeys.length === 1 ? 'key' : 'keys'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsBulkEditing(!isBulkEditing)}
                  className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer font-medium"
                >
                  <ClipboardList className="h-3 w-3" />
                  <span>{isBulkEditing ? 'Card View' : 'Bulk / Paste'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="text-slate-400 hover:text-slate-200 cursor-pointer"
                  title={showKey ? 'Hide keys' : 'Reveal keys'}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* Bulk Edit Textarea Mode */}
            {isBulkEditing ? (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400">
                  Paste multiple keys below (one per line or separated by commas):
                </p>
                <textarea
                  value={bulkInputText}
                  onChange={(e) => setBulkInputText(e.target.value)}
                  placeholder="Paste keys here (one key per line)..."
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg p-2.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 resize-y"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBulkInputText(currentKeys.join('\n'));
                      setIsBulkEditing(false);
                    }}
                    className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveBulkKeys}
                    className="px-3 py-1 text-xs rounded font-medium bg-sky-500 hover:bg-sky-400 text-slate-950 cursor-pointer"
                  >
                    Apply Keys ({normalizeApiKeys(bulkInputText).length})
                  </button>
                </div>
              </div>
            ) : (
              /* Card / List View Mode */
              <div className="space-y-2">
                {/* Add Single Key Input */}
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={newKeyInput}
                      onChange={(e) => setNewKeyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddSingleKey();
                        }
                      }}
                      placeholder={`Add ${activeDef.name} API key to pool...`}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddSingleKey}
                    disabled={!newKeyInput.trim()}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add</span>
                  </button>
                </div>

                {/* List of Configured Keys */}
                {currentKeys.length === 0 ? (
                  <div className="text-[11px] text-amber-400/90 flex items-center gap-1.5 py-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>No API keys added yet. Add at least one key to use this provider.</span>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {currentKeys.map((k, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200"
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="text-[10px] text-slate-500 font-bold shrink-0">
                            #{idx + 1}
                          </span>
                          <span className="truncate">
                            {showKey ? k : maskApiKey(k)}
                          </span>
                          {idx === 0 && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                              Primary
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveKey(idx)}
                          className="text-slate-500 hover:text-rose-400 transition-colors p-1 cursor-pointer shrink-0"
                          title="Remove key from pool"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Rotation Strategy Selector */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <label className="text-[11px] font-semibold text-slate-300 block">
                Rotation Strategy
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: 'use_until_error' as KeyRotationStrategy,
                    name: 'Use Until Error',
                    desc: 'Uses active key until 429/error, then rotates',
                    icon: ShieldAlert,
                  },
                  {
                    id: 'round_robin' as KeyRotationStrategy,
                    name: 'Round Robin',
                    desc: 'Rotates sequentially (1 → 2 → 3) per request',
                    icon: RotateCw,
                  },
                  {
                    id: 'random' as KeyRotationStrategy,
                    name: 'Random',
                    desc: 'Picks a random key from the pool each turn',
                    icon: Shuffle,
                  },
                ].map((strat) => {
                  const Icon = strat.icon;
                  const isSelected = currentStrategy === strat.id;

                  return (
                    <button
                      key={strat.id}
                      type="button"
                      onClick={() => handleStrategyChange(strat.id)}
                      className={`p-2 rounded-lg border text-left flex flex-col justify-between transition-all cursor-pointer ${
                        isSelected
                          ? 'border-sky-500 bg-sky-500/15 shadow-sm'
                          : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-sky-400' : 'text-slate-400'}`} />
                        {isSelected && <Check className="h-3 w-3 text-sky-400" />}
                      </div>
                      <div className={`text-xs font-semibold ${isSelected ? 'text-sky-300' : 'text-slate-300'}`}>
                        {strat.name}
                      </div>
                      <div className="text-[10px] text-slate-400 leading-tight mt-0.5">
                        {strat.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
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
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 disabled:opacity-50 font-medium cursor-pointer"
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

          {errorMessage && (
            <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded">
              {errorMessage}
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

        {/* Task Price Budget (USD) */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300 font-medium">Task Price Budget</span>
            <span className="font-mono text-emerald-400 font-bold">
              {settings.agent.maxBudgetUSD > 0
                ? `$${settings.agent.maxBudgetUSD.toFixed(2)} USD`
                : 'Unlimited'}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1 text-[11px]">
            {[
              { label: '$0.05', val: 0.05 },
              { label: '$0.10', val: 0.10 },
              { label: '$0.25', val: 0.25 },
              { label: '$0.50', val: 0.50 },
              { label: 'None', val: 0 },
            ].map((b) => (
              <button
                key={b.val}
                type="button"
                onClick={() => onUpdateAgent({ maxBudgetUSD: b.val })}
                className={`py-1 rounded border text-center font-mono transition-colors cursor-pointer ${
                  settings.agent.maxBudgetUSD === b.val
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-semibold'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[11px] text-slate-400 shrink-0">Custom ($):</span>
            <input
              type="number"
              min="0"
              step="0.05"
              value={settings.agent.maxBudgetUSD || ''}
              onChange={(e) => {
                const num = parseFloat(e.target.value);
                onUpdateAgent({ maxBudgetUSD: isNaN(num) || num < 0 ? 0 : num });
              }}
              placeholder="0 for unlimited"
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <p className="text-[10px] text-slate-400 leading-normal">
            No fixed step limits. If model API usage reaches this spending cap, the agent will pause and request confirmation before spending more.
          </p>
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
            className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
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
