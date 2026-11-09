import React, { useState, useRef, useEffect } from 'react';
import { Header, ActiveTab } from './components/Header';
import { SettingsView } from './components/SettingsView';
import { ChatView } from './components/ChatView';
import { HistoryView } from './components/HistoryView';
import { useSettings } from './hooks/useSettings';
import { AgentExecution, StepRecord, TargetTabInfo } from '../core/agent/loop';
import { saveTask, TaskRecord } from '../core/storage/db';
import { PROVIDERS } from '../core/llm/providers/registry';

export interface ChatTurn {
  id: string;
  userPrompt: string;
  timestamp: number;
  steps: StepRecord[];
  resultSummary?: string | null;
  status: 'running' | 'completed' | 'failed' | 'paused';
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
  const [currentStep, setCurrentStep] = useState(1);
  const [liveStatus, setLiveStatus] = useState('');
  const [liveCostUSD, setLiveCostUSD] = useState(0);
  const [liveTokens, setLiveTokens] = useState(0);
  const [liveCachedTokens, setLiveCachedTokens] = useState(0);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [targetTab, setTargetTab] = useState<TargetTabInfo | null>(null);

  const activeExecutionRef = useRef<AgentExecution | null>(null);
  const userPromptResolverRef = useRef<((answer: string) => void) | null>(null);

  // Dynamically track active tab when idle, locking onto targetTab when running
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    const updateActiveTab = () => {
      // If a task is actively running or session is ongoing, do NOT switch away from locked tab
      if (isRunning || activeExecutionRef.current) return;

      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          setTargetTab({
            id: tabs[0].id,
            title: tabs[0].title || 'Active Tab',
            url: tabs[0].url || '',
            favIconUrl: tabs[0].favIconUrl,
          });
        }
      });
    };

    updateActiveTab();

    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      if (isRunning || activeExecutionRef.current) return;
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        setTargetTab({
          id: tab.id!,
          title: tab.title || 'Tab #' + tab.id,
          url: tab.url || '',
          favIconUrl: tab.favIconUrl,
        });
      });
    };

    const handleUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (isRunning || activeExecutionRef.current) return;
      if (tab.active && (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url)) {
        setTargetTab({
          id: tab.id!,
          title: tab.title || 'Tab #' + tab.id,
          url: tab.url || '',
          favIconUrl: tab.favIconUrl,
        });
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [isRunning]);

  const handleFocusTab = () => {
    if (targetTab?.id && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.update(targetTab.id, { active: true });
    }
  };

  const handleCreateNewTab = async () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const newTab = await chrome.tabs.create({ url: 'https://www.google.com', active: true });
      if (newTab.id) {
        setTargetTab({
          id: newTab.id,
          title: newTab.title || 'New Agent Tab',
          url: newTab.url || 'https://www.google.com',
        });
      }
    }
  };

  const handleNewChat = () => {
    if (activeExecutionRef.current) {
      activeExecutionRef.current.abort();
      activeExecutionRef.current = null;
    }
    setIsRunning(false);
    setIsPaused(false);
    setTurns([]);
    setCurrentStep(1);
    setLiveCostUSD(0);
    setLiveTokens(0);
    setLiveCachedTokens(0);
    setPendingQuestion(null);
    setLiveStatus('');

    // Re-detect current active tab for new session
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs && tabs[0]?.id) {
          setTargetTab({
            id: tabs[0].id,
            title: tabs[0].title || 'Active Tab',
            url: tabs[0].url || '',
            favIconUrl: tabs[0].favIconUrl,
          });
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
    setLiveStatus('Initializing agent on assigned tab...');

    const startTime = Date.now();

    const execution = new AgentExecution(
      settings,
      goal,
      {
        onStepStart: (num) => {
          setCurrentStep(num);
        },
        onStepComplete: (step) => {
          setTurns((prev) => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const currentTurn = prev[lastIdx];
            const existingStepIdx = currentTurn.steps.findIndex((s) => s.stepNumber === step.stepNumber);
            let updatedSteps: StepRecord[];
            if (existingStepIdx >= 0) {
              updatedSteps = [...currentTurn.steps];
              updatedSteps[existingStepIdx] = { ...step };
            } else {
              updatedSteps = [...currentTurn.steps, step];
            }
            const updatedTurn = { ...currentTurn, steps: updatedSteps };
            const nextTurns = [...prev];
            nextTurns[lastIdx] = updatedTurn;
            return nextTurns;
          });
        },
        onCostUpdate: (cost, tokens, cached) => {
          setLiveCostUSD(cost);
          setLiveTokens(tokens);
          if (cached !== undefined) setLiveCachedTokens(cached);
        },
        onLog: (msg) => {
          setLiveStatus(msg);
        },
        onFinish: (summary) => {
          setTurns((prev) => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const nextTurns = [...prev];
            nextTurns[lastIdx] = {
              ...nextTurns[lastIdx],
              resultSummary: summary,
              status: 'completed',
            };
            return nextTurns;
          });
          setLiveStatus('Task completed.');
        },
        onError: (err) => {
          setLiveStatus(`Error: ${err.message}`);
        },
        onAskUser: (question: string) => {
          setPendingQuestion(question);
          return new Promise<string>((resolve) => {
            userPromptResolverRef.current = resolve;
          });
        },
        onTargetTabChanged: (info) => {
          setTargetTab(info);
        },
      },
      undefined,
      undefined,
      targetTab?.id
    );

    activeExecutionRef.current = execution;

    try {
      const summary = await execution.run();

      setTurns((prev) => {
        if (prev.length === 0) return prev;
        const lastIdx = prev.length - 1;
        const nextTurns = [...prev];
        nextTurns[lastIdx] = {
          ...nextTurns[lastIdx],
          resultSummary: summary,
          status: execution.isPaused() ? 'paused' : 'completed',
        };
        return nextTurns;
      });

      if (execution.isPaused()) {
        setIsPaused(true);
      } else {
        await saveTask({
          id: `task_${Date.now()}`,
          goal,
          provider: activeDef.name,
          model: currentModel,
          status: 'completed',
          stepCount: execution.getSteps().length,
          resultSummary: summary,
          steps: execution.getSteps(),
          messages: execution.getMessages(),
          createdAt: startTime,
          completedAt: Date.now(),
        });
      }
    } catch (err: any) {
      console.error('[BrowserAgent] Execution error:', err);
      setTurns((prev) => {
        if (prev.length === 0) return prev;
        const lastIdx = prev.length - 1;
        const nextTurns = [...prev];
        nextTurns[lastIdx] = {
          ...nextTurns[lastIdx],
          resultSummary: `Task terminated with error: ${err.message}`,
          status: 'failed',
        };
        return nextTurns;
      });

      await saveTask({
        id: `task_${Date.now()}`,
        goal,
        provider: activeDef.name,
        model: currentModel,
        status: 'failed',
        stepCount: execution.getSteps().length,
        resultSummary: err.message,
        steps: execution.getSteps(),
        messages: execution.getMessages(),
        createdAt: startTime,
        completedAt: Date.now(),
      });
    } finally {
      setIsRunning(false);
      setPendingQuestion(null);
      // Guarantee all steps are finalized (no spinning loaders)
      setTurns((prev) =>
        prev.map((turn) => ({
          ...turn,
          status: turn.status === 'running' ? 'completed' : turn.status,
          steps: turn.steps.map((s) => ({
            ...s,
            status: s.status === 'running' ? (s.resultMessage?.includes('failed') ? 'failed' : 'success') : s.status,
          })),
        }))
      );
    }
  };

  const handlePauseTask = () => {
    if (activeExecutionRef.current) {
      activeExecutionRef.current.pause();
      setIsPaused(true);
      setLiveStatus('Task paused. Enter follow-up instructions to resume.');
    }
  };

  const handleResumeTask = async (followUpText: string) => {
    if (!activeExecutionRef.current) {
      handleStartTask(followUpText);
      return;
    }

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

    try {
      const summary = await activeExecutionRef.current.run(followUpText);

      setTurns((prev) => {
        if (prev.length === 0) return prev;
        const lastIdx = prev.length - 1;
        const nextTurns = [...prev];
        nextTurns[lastIdx] = {
          ...nextTurns[lastIdx],
          resultSummary: summary,
          status: activeExecutionRef.current?.isPaused() ? 'paused' : 'completed',
        };
        return nextTurns;
      });

      if (activeExecutionRef.current.isPaused()) {
        setIsPaused(true);
      } else {
        await saveTask({
          id: `task_${Date.now()}`,
          goal: followUpText,
          provider: activeDef.name,
          model: currentModel,
          status: 'completed',
          stepCount: activeExecutionRef.current.getSteps().length,
          resultSummary: summary,
          steps: activeExecutionRef.current.getSteps(),
          messages: activeExecutionRef.current.getMessages(),
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
      }
    } catch (err: any) {
      setLiveStatus(`Error: ${err.message}`);
    } finally {
      setIsRunning(false);
      // Guarantee all steps are finalized
      setTurns((prev) =>
        prev.map((turn) => ({
          ...turn,
          status: turn.status === 'running' ? 'completed' : turn.status,
          steps: turn.steps.map((s) => ({
            ...s,
            status: s.status === 'running' ? (s.resultMessage?.includes('failed') ? 'failed' : 'success') : s.status,
          })),
        }))
      );
    }
  };

  const handleSendSteering = (guidance: string) => {
    if (activeExecutionRef.current) {
      activeExecutionRef.current.addSteeringMessage(guidance);
    }
  };

  const handleAnswerQuestion = (answer: string) => {
    if (userPromptResolverRef.current) {
      userPromptResolverRef.current(answer);
      userPromptResolverRef.current = null;
    }
    setPendingQuestion(null);
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

    setTurns(task.turns && task.turns.length > 0 ? task.turns : [historyTurn]);
    setCurrentStep((task.steps?.length || 0) + 1);
    setIsPaused(false);
    setIsRunning(false);
    setPendingQuestion(null);
    setLiveStatus(`Loaded past task: "${task.goal.slice(0, 35)}...". Enter a follow-up to continue in this same chat.`);

    const execution = new AgentExecution(
      settings,
      task.goal,
      {
        onStepStart: (num) => setCurrentStep(num),
        onStepComplete: (step) => {
          setTurns((prev) => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const currentTurn = prev[lastIdx];
            const existingStepIdx = currentTurn.steps.findIndex((s) => s.stepNumber === step.stepNumber);
            let updatedSteps: StepRecord[];
            if (existingStepIdx >= 0) {
              updatedSteps = [...currentTurn.steps];
              updatedSteps[existingStepIdx] = { ...step };
            } else {
              updatedSteps = [...currentTurn.steps, step];
            }
            const updatedTurn = { ...currentTurn, steps: updatedSteps };
            const nextTurns = [...prev];
            nextTurns[lastIdx] = updatedTurn;
            return nextTurns;
          });
        },
        onCostUpdate: (cost, tokens, cached) => {
          setLiveCostUSD(cost);
          setLiveTokens(tokens);
          if (cached !== undefined) setLiveCachedTokens(cached);
        },
        onLog: (msg) => setLiveStatus(msg),
        onFinish: (summary) => {
          setTurns((prev) => {
            if (prev.length === 0) return prev;
            const lastIdx = prev.length - 1;
            const nextTurns = [...prev];
            nextTurns[lastIdx] = {
              ...nextTurns[lastIdx],
              resultSummary: summary,
              status: 'completed',
            };
            return nextTurns;
          });
          setLiveStatus('Task completed.');
        },
        onError: (err) => setLiveStatus(`Error: ${err.message}`),
        onAskUser: (question: string) => {
          setPendingQuestion(question);
          return new Promise<string>((resolve) => {
            userPromptResolverRef.current = resolve;
          });
        },
        onTargetTabChanged: (info) => {
          setTargetTab(info);
        },
      },
      task.messages,
      task.steps,
      targetTab?.id
    );
    activeExecutionRef.current = execution;

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
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {currentTab === 'chat' && (
          <ChatView
            isRunning={isRunning}
            isPaused={isPaused}
            hasActiveSession={!!activeExecutionRef.current}
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
            targetTab={targetTab}
            onFocusTab={handleFocusTab}
            onCreateNewTab={handleCreateNewTab}
            onGetFullMessages={() => activeExecutionRef.current?.getMessages() || []}
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
