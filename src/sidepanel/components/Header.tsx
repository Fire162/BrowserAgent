import React from 'react';
import { Bot, Sliders, History, Sparkles, PanelRightClose } from 'lucide-react';
import { AllSettings } from '../../core/llm/types';
import { PROVIDERS } from '../../core/llm/providers/registry';

export type ActiveTab = 'chat' | 'settings' | 'history';

interface HeaderProps {
  currentTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  settings: AllSettings;
  isRunning: boolean;
  onHideSidepanel?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  settings,
  isRunning,
  onHideSidepanel,
}) => {
  const activeDef = PROVIDERS[settings.activeProvider];
  const activeConfig = settings.providers[settings.activeProvider];
  const currentModelName =
    activeConfig.customModelId || activeConfig.selectedModel || activeDef?.defaultModel || 'Default';

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-3 py-2.5 flex flex-col gap-2 select-none">
      <div className="flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-white">BrowserAgent</span>
              <span className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-1 rounded font-mono">v1.2.2</span>
            </div>
          </div>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center gap-1.5">
          {/* Model Indicator Pill */}
          <div
            onClick={() => onSelectTab('settings')}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300 hover:border-sky-500/40 hover:text-white cursor-pointer transition-colors max-w-[155px]"
            title="Click to change Provider or Model"
          >
            <Sparkles className="h-3 w-3 text-sky-400 shrink-0" />
            <span className="font-medium truncate text-[11px]">
              {activeDef?.name || settings.activeProvider}: <span className="text-slate-400">{currentModelName.split('/').pop()}</span>
            </span>
          </div>

          {/* Hide Sidepanel Button */}
          {onHideSidepanel && (
            <button
              onClick={onHideSidepanel}
              className="p-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-700 transition-colors flex items-center justify-center shrink-0 relative group"
              title="Hide Sidepanel (runs continuously in background)"
              aria-label="Hide Sidepanel"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
              {isRunning && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-pulse" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-950/60 p-0.5 rounded-lg border border-slate-800/80 text-xs font-medium">
        <button
          onClick={() => onSelectTab('chat')}
          className={`flex-1 py-1 px-2 rounded-md flex items-center justify-center gap-1.5 transition-all ${
            currentTab === 'chat'
              ? 'bg-sky-500 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Bot className="h-3.5 w-3.5" />
          <span>Task Runner</span>
          {isRunning && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          )}
        </button>

        <button
          onClick={() => onSelectTab('settings')}
          className={`flex-1 py-1 px-2 rounded-md flex items-center justify-center gap-1.5 transition-all ${
            currentTab === 'settings'
              ? 'bg-sky-500 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>Keys & Models</span>
        </button>

        <button
          onClick={() => onSelectTab('history')}
          className={`flex-1 py-1 px-2 rounded-md flex items-center justify-center gap-1.5 transition-all ${
            currentTab === 'history'
              ? 'bg-sky-500 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          <span>History</span>
        </button>
      </div>
    </header>
  );
};
