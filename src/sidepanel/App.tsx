import React, { useState, useRef } from 'react';
import { Header, ActiveTab } from './components/Header';
import { SettingsView } from './components/SettingsView';
import { ChatView } from './components/ChatView';
import { HistoryView } from './components/HistoryView';
import { useSettings } from './hooks/useSettings';
import { AgentExecution, StepRecord } from '../core/agent/loop';
import { saveTask, TaskRecord } from '../core/storage/db';
import { PROVIDERS } from '../core/llm/providers/registry';

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
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const activeExecutionRef = useRef<AgentExecution | null>(null);
  const userPromptResolverRef = useRef<((answer: string) => void) | null>(null);

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

    setIsRunning(true);
    setIsPaused(false);
    setSteps([]);
    setFinalResult(null);
    setCurrentStep(1);
    setLiveCostUSD(0);
    setLiveTokens(0);
    setPendingQuestion(null);
    setLiveStatus('Initializing agent...');

    const startTime = Date.now();

    const execution = new AgentExecution(settings, goal, {
      onStepStart: (num) => {
        setCurrentStep(num);
      },
      onStepComplete: (step) => {
        setSteps((prev) => [...prev, step]);
      },
      onCostUpdate: (cost, tokens) => {
        setLiveCostUSD(cost);
        setLiveTokens(tokens);
      },
      onLog: (msg) => {
        setLiveStatus(msg);
      },
      onFinish: (summary) => {
        setFinalResult(summary);
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
    });

    activeExecutionRef.current = execution;

    try {
      const summary = await execution.run();
      setFinalResult(summary);

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
      setFinalResult(`Task terminated with error: ${err.message}`);

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

    setIsRunning(true);
    setIsPaused(false);
    setLiveStatus('Resuming task with your follow-up instruction...');

    try {
      const summary = await activeExecutionRef.current.run(followUpText);
      setFinalResult(summary);

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
    setSteps(task.steps || []);
    setFinalResult(task.resultSummary || null);
    setCurrentStep((task.steps?.length || 0) + 1);
    setIsPaused(true);
    setIsRunning(false);
    setPendingQuestion(null);
    setLiveStatus(`Loaded past task: "${task.goal.slice(0, 35)}...". Enter a follow-up to continue.`);

    const execution = new AgentExecution(
      settings,
      task.goal,
      {
        onStepStart: (num) => setCurrentStep(num),
        onStepComplete: (step) => setSteps((prev) => [...prev, step]),
        onCostUpdate: (cost, tokens) => {
          setLiveCostUSD(cost);
          setLiveTokens(tokens);
        },
        onLog: (msg) => setLiveStatus(msg),
        onFinish: (summary) => {
          setFinalResult(summary);
          setLiveStatus('Task completed.');
        },
        onError: (err) => setLiveStatus(`Error: ${err.message}`),
        onAskUser: (question: string) => {
          setPendingQuestion(question);
          return new Promise<string>((resolve) => {
            userPromptResolverRef.current = resolve;
          });
        },
      },
      task.messages,
      task.steps
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
            onStartTask={handleStartTask}
            onPauseTask={handlePauseTask}
            onResumeTask={handleResumeTask}
            onSendSteering={handleSendSteering}
            currentStep={currentStep}
            maxBudgetUSD={settings.agent.maxBudgetUSD}
            liveCostUSD={liveCostUSD}
            liveTokens={liveTokens}
            liveStatus={liveStatus}
            steps={steps}
            finalResult={finalResult}
            activeProvider={activeDef.name}
            activeModel={currentModel}
            pendingQuestion={pendingQuestion}
            onAnswerQuestion={handleAnswerQuestion}
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
