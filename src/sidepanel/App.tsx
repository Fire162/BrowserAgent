import React, { useState, useRef, useEffect } from 'react';
import { Header, ActiveTab } from './components/Header';
import { SettingsView } from './components/SettingsView';
import { ChatView } from './components/ChatView';
import { HistoryView } from './components/HistoryView';
import { useSettings } from './hooks/useSettings';
import { StepRecord, TargetTabInfo, BudgetLimitDecision } from '../core/agent/loop';
import { TaskRecord } from '../core/storage/db';
import { PROVIDERS } from '../core/llm/providers/registry';

export interface ChatTurn {
  id: string;
  userPrompt: string;
  timestamp: number;
  steps: StepRecord[];
  resultSummary?: string | null;
  status: 'running' | 'completed' | 'failed' | 'paused';
  steeringMessages?: string[];
}

export interface BudgetLimitEvent {
  currentSpentUSD: number;
  currentCapUSD: number;
}

export const App: React.FC = () => {
  const {
    settings,
    loading,
    setActiveProvider,
    updateProviderConfig,
    updateAgentConfig,
  } = useSettings();

  const [currentTab, setCurrentTab] = useState<ActiveTab>('chat');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [liveStatus, setLiveStatus] = useState('');
  const [liveCostUSD, setLiveCostUSD] = useState(0);
  const [liveTokens, setLiveTokens] = useState(0);
  const [liveCachedTokens, setLiveCachedTokens] = useState(0);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingBudgetLimit, setPendingBudgetLimit] = useState<BudgetLimitEvent | null>(null);
  const [targetTab, setTargetTab] = useState<TargetTabInfo | null>(null);

  const cachedMessagesRef = useRef<any[]>([]);

  // 1. Initial State Hydration from Background Engine & Event Synchronization
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

    // Request initial state from background
    chrome.runtime.sendMessage({ action: 'get_engine_state' }, (res) => {
      if (res?.success && res.state) {
        const s = res.state;
        setIsRunning(s.isRunning);
        setIsPaused(s.isPaused);
        setCurrentStep(s.currentStep || 1);
        setLiveStatus(s.liveStatus || '');
        setLiveCostUSD(s.liveCostUSD || 0);
        setLiveTokens(s.liveTokens || 0);
        setLiveCachedTokens(s.liveCachedTokens || 0);
        setTurns(s.turns || []);
        setPendingQuestion(s.pendingQuestion);
        setPendingBudgetLimit(s.pendingBudgetLimit);
        if (s.targetTab) setTargetTab(s.targetTab);
        setHasActiveSession(Boolean(res.hasActiveSession || (s.turns && s.turns.length > 0)));
      }
    });

    // Request full messages cache for transcript export
    chrome.runtime.sendMessage({ action: 'get_full_messages' }, (res) => {
      if (res?.success && res.messages) {
        cachedMessagesRef.current = res.messages;
      }
    });

    // Listen to live background engine broadcasts
    const messageListener = (request: any) => {
      if (request?.action === 'ENGINE_EVENT') {
        const event = request.event;
        if (!event) return;

        switch (event.type) {
          case 'STATUS_SYNC': {
            const s = event.state;
            if (s) {
              setIsRunning(s.isRunning);
              setIsPaused(s.isPaused);
              setCurrentStep(s.currentStep);
              setLiveStatus(s.liveStatus);
              setLiveCostUSD(s.liveCostUSD);
              setLiveTokens(s.liveTokens);
              setLiveCachedTokens(s.liveCachedTokens);
              setTurns(s.turns || []);
              setPendingQuestion(s.pendingQuestion);
              setPendingBudgetLimit(s.pendingBudgetLimit);
              if (s.targetTab) setTargetTab(s.targetTab);
              setHasActiveSession(Boolean(s.hasActiveSession || (s.turns && s.turns.length > 0)));
            }
            break;
          }
          case 'STEP_START':
            setCurrentStep(event.stepNumber);
            break;
          case 'STEP_COMPLETE':
            if (event.turns) setTurns(event.turns);
            // Refresh messages cache
            chrome.runtime.sendMessage({ action: 'get_full_messages' }, (res) => {
              if (res?.messages) cachedMessagesRef.current = res.messages;
            });
            break;
          case 'COST_UPDATE':
            setLiveCostUSD(event.cost);
            setLiveTokens(event.tokens);
            if (event.cached !== undefined) setLiveCachedTokens(event.cached);
            break;
          case 'LOG':
            setLiveStatus(event.message);
            break;
          case 'FINISH':
            setIsRunning(false);
            if (event.turns) setTurns(event.turns);
            setLiveStatus('Task completed.');
            chrome.runtime.sendMessage({ action: 'get_full_messages' }, (res) => {
              if (res?.messages) cachedMessagesRef.current = res.messages;
            });
            break;
          case 'ERROR':
            setIsRunning(false);
            setLiveStatus(`Error: ${event.error}`);
            break;
          case 'ASK_USER':
            setPendingQuestion(event.question);
            break;
          case 'BUDGET_LIMIT':
            setPendingBudgetLimit({ currentSpentUSD: event.currentSpentUSD, currentCapUSD: event.currentCapUSD });
            break;
          case 'TARGET_TAB_CHANGED':
            if (event.info) setTargetTab(event.info);
            break;
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // 2. Dynamically track active tab when idle
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    const updateActiveTab = () => {
      // If a task is actively running or session is ongoing, do NOT switch away from locked tab
      if (isRunning || hasActiveSession) return;

      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          const tabInfo: TargetTabInfo = {
            id: tabs[0].id,
            title: tabs[0].title || 'Active Tab',
            url: tabs[0].url || '',
            favIconUrl: tabs[0].favIconUrl,
          };
          setTargetTab(tabInfo);
          chrome.runtime.sendMessage({ action: 'set_target_tab', params: { tabInfo } });
        }
      });
    };

    updateActiveTab();

    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      if (isRunning || hasActiveSession) return;
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        const tabInfo: TargetTabInfo = {
          id: tab.id!,
          title: tab.title || 'Tab #' + tab.id,
          url: tab.url || '',
          favIconUrl: tab.favIconUrl,
        };
        setTargetTab(tabInfo);
        chrome.runtime.sendMessage({ action: 'set_target_tab', params: { tabInfo } });
      });
    };

    const handleUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (isRunning || hasActiveSession) return;
      if (tab.active && (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url)) {
        const tabInfo: TargetTabInfo = {
          id: tab.id!,
          title: tab.title || 'Tab #' + tab.id,
          url: tab.url || '',
          favIconUrl: tab.favIconUrl,
        };
        setTargetTab(tabInfo);
        chrome.runtime.sendMessage({ action: 'set_target_tab', params: { tabInfo } });
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [isRunning, hasActiveSession]);

  const handleFocusTab = () => {
    if (targetTab?.id && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.update(targetTab.id, { active: true });
    }
  };

  const handleCreateNewTab = async () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const newTab = await chrome.tabs.create({ url: 'https://www.google.com', active: true });
      if (newTab.id) {
        const tabInfo: TargetTabInfo = {
          id: newTab.id,
          title: newTab.title || 'New Agent Tab',
          url: newTab.url || 'https://www.google.com',
        };
        setTargetTab(tabInfo);
        chrome.runtime.sendMessage({ action: 'set_target_tab', params: { tabInfo } });
      }
    }
  };

  const handleHideSidepanel = () => {
    // Closes the sidepanel document; execution continues uninterrupted in background service worker
    window.close();
  };

  const handleNewChat = () => {
    setIsRunning(false);
    setIsPaused(false);
    setTurns([]);
    setCurrentStep(1);
    setLiveCostUSD(0);
    setLiveTokens(0);
    setLiveCachedTokens(0);
    setPendingQuestion(null);
    setPendingBudgetLimit(null);
    setHasActiveSession(false);
    setLiveStatus('');
    cachedMessagesRef.current = [];

    chrome.runtime.sendMessage({ action: 'new_chat' });

    // Re-detect current active tab for new session
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs && tabs[0]?.id) {
          const tabInfo: TargetTabInfo = {
            id: tabs[0].id,
            title: tabs[0].title || 'Active Tab',
            url: tabs[0].url || '',
            favIconUrl: tabs[0].favIconUrl,
          };
          setTargetTab(tabInfo);
          chrome.runtime.sendMessage({ action: 'set_target_tab', params: { tabInfo } });
        }
      });
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full bg-slate-950 flex items-center justify-center text-slate-400 text-xs">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading BrowserAgent...</span>
        </div>
      </div>
    );
  }

  const activeConfig = settings.providers[settings.activeProvider];
  const activeDef = PROVIDERS[settings.activeProvider];
  const currentModel = activeConfig.customModelId || activeConfig.selectedModel || activeDef.defaultModel;

  const handleStartTask = async (goal: string) => {
    if (activeDef.requiresApiKey && !activeConfig.apiKey?.trim()) {
      alert(`Please enter an API Key for ${activeDef.name} in Settings before running tasks.`);
      setCurrentTab('settings');
      return;
    }

    const initialTurn: ChatTurn = {
      id: `turn_${Date.now()}`,
      userPrompt: goal,
      timestamp: Date.now(),
      steps: [],
      resultSummary: null,
      status: 'running',
    };

    setIsRunning(true);
    setIsPaused(false);
    setTurns([initialTurn]);
    setCurrentStep(1);
    setLiveCostUSD(0);
    setLiveTokens(0);
    setLiveCachedTokens(0);
    setPendingQuestion(null);
    setPendingBudgetLimit(null);
    setHasActiveSession(true);
    setLiveStatus('Initializing agent on assigned tab...');

    chrome.runtime.sendMessage({
      action: 'start_task',
      params: {
        goal,
        settings,
        targetTabId: targetTab?.id,
      },
    });
  };

  const handlePauseTask = () => {
    setIsPaused(true);
    setLiveStatus('Task paused. Enter follow-up instructions to resume.');
    chrome.runtime.sendMessage({ action: 'pause_task' });
  };

  const handleResumeTask = async (followUpText: string) => {
    const followUpTurn: ChatTurn = {
      id: `turn_${Date.now()}`,
      userPrompt: followUpText,
      timestamp: Date.now(),
      steps: [],
      resultSummary: null,
      status: 'running',
    };

    setIsRunning(true);
    setIsPaused(false);
    setTurns((prev) => [...prev, followUpTurn]);
    setLiveStatus('Continuing task on assigned tab with follow-up...');

    chrome.runtime.sendMessage({
      action: 'resume_task',
      params: {
        followUpText,
        settings,
      },
    });
  };

  const handleSendSteering = (guidance: string) => {
    if (!guidance.trim()) return;
    chrome.runtime.sendMessage({
      action: 'send_steering',
      params: { message: guidance.trim() },
    });
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const lastIdx = prev.length - 1;
      const currentTurn = prev[lastIdx];
      const existing = currentTurn.steeringMessages || [];
      const nextTurns = [...prev];
      nextTurns[lastIdx] = {
        ...currentTurn,
        steeringMessages: [...existing, guidance.trim()],
      };
      return nextTurns;
    });
  };

  const handleAnswerQuestion = (answer: string) => {
    setPendingQuestion(null);
    chrome.runtime.sendMessage({
      action: 'answer_question',
      params: { answer },
    });
  };

  const handleResolveBudgetLimit = (decision: BudgetLimitDecision) => {
    setPendingBudgetLimit(null);
    chrome.runtime.sendMessage({
      action: 'resolve_budget_limit',
      params: { decision },
    });
  };

  const handleResumeHistoryTask = (task: TaskRecord) => {
    const historyTurn: ChatTurn = {
      id: `history_${task.createdAt}`,
      userPrompt: task.goal,
      timestamp: task.createdAt,
      steps: task.steps || [],
      resultSummary: task.resultSummary || null,
      status: task.status === 'completed' ? 'completed' : 'failed',
    };

    const loadedTurns = task.turns && task.turns.length > 0 ? task.turns : [historyTurn];
    setTurns(loadedTurns);
    setCurrentStep((task.steps?.length || 0) + 1);
    setIsPaused(false);
    setIsRunning(false);
    setPendingQuestion(null);
    setPendingBudgetLimit(null);
    setHasActiveSession(true);
    setLiveStatus(`Loaded past task: "${task.goal.slice(0, 35)}...". Enter a follow-up to continue in this same chat.`);

    chrome.runtime.sendMessage({
      action: 'resume_history_task',
      params: { task, settings },
    });

    setCurrentTab('chat');
  };

  const handleRerun = (goal: string) => {
    setCurrentTab('chat');
    handleStartTask(goal);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 font-sans selection:bg-sky-500 selection:text-white">
      <Header
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        settings={settings}
        isRunning={isRunning}
        onHideSidepanel={handleHideSidepanel}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {currentTab === 'chat' && (
          <ChatView
            isRunning={isRunning}
            isPaused={isPaused}
            hasActiveSession={hasActiveSession}
            onStartTask={handleStartTask}
            onPauseTask={handlePauseTask}
            onResumeTask={handleResumeTask}
            onSendSteering={handleSendSteering}
            onNewChat={handleNewChat}
            turns={turns}
            currentStep={currentStep}
            maxBudgetUSD={settings.agent.maxBudgetUSD}
            liveCostUSD={liveCostUSD}
            liveTokens={liveTokens}
            liveCachedTokens={liveCachedTokens}
            liveStatus={liveStatus}
            activeProvider={activeDef.name}
            activeModel={currentModel}
            pendingQuestion={pendingQuestion}
            onAnswerQuestion={handleAnswerQuestion}
            pendingBudgetLimit={pendingBudgetLimit}
            onResolveBudgetLimit={handleResolveBudgetLimit}
            targetTab={targetTab}
            onFocusTab={handleFocusTab}
            onCreateNewTab={handleCreateNewTab}
            onGetFullMessages={() => cachedMessagesRef.current}
          />
        )}

        {currentTab === 'settings' && (
          <SettingsView
            settings={settings}
            onSetActiveProvider={setActiveProvider}
            onUpdateProvider={updateProviderConfig}
            onUpdateAgent={updateAgentConfig}
          />
        )}

        {currentTab === 'history' && (
          <HistoryView
            onRerunTask={handleRerun}
            onResumeTaskInChat={handleResumeHistoryTask}
          />
        )}
      </main>
    </div>
  );
};
