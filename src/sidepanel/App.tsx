import React, { useState, useRef } from 'react';
import { Header, ActiveTab } from './components/Header';
import { SettingsView } from './components/SettingsView';
import { ChatView } from './components/ChatView';
import { HistoryView } from './components/HistoryView';
import { useSettings } from './hooks/useSettings';
import { AgentExecution, StepRecord } from '../core/agent/loop';
import { saveTask } from '../core/storage/db';
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
  const [currentStep, setCurrentStep] = useState(1);
  const [liveStatus, setLiveStatus] = useState('');
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
    setSteps([]);
    setFinalResult(null);
    setCurrentStep(1);
    setPendingQuestion(null);
    setLiveStatus('Initializing agent...');

    const startTime = Date.now();
    let recordedSteps: StepRecord[] = [];

    const execution = new AgentExecution(settings, goal, {
      onStepStart: (num) => {
        setCurrentStep(num);
      },
      onStepComplete: (step) => {
        setSteps((prev) => [...prev, step]);
        recordedSteps.push(step);
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

      await saveTask({
        id: `task_${Date.now()}`,
        goal,
        provider: activeDef.name,
        model: currentModel,
        status: 'completed',
        stepCount: recordedSteps.length,
        resultSummary: summary,
        createdAt: startTime,
        completedAt: Date.now(),
      });
    } catch (err: any) {
      console.error('[BrowserAgent] Execution error:', err);
      setFinalResult(`Task terminated with error: ${err.message}`);

      await saveTask({
        id: `task_${Date.now()}`,
        goal,
        provider: activeDef.name,
        model: currentModel,
        status: 'failed',
        stepCount: recordedSteps.length,
        resultSummary: err.message,
        createdAt: startTime,
        completedAt: Date.now(),
      });
    } finally {
      setIsRunning(false);
      setPendingQuestion(null);
      activeExecutionRef.current = null;
      userPromptResolverRef.current = null;
    }
  };

  const handleAnswerQuestion = (answer: string) => {
    if (userPromptResolverRef.current) {
      userPromptResolverRef.current(answer);
      userPromptResolverRef.current = null;
    }
    setPendingQuestion(null);
  };

  const handleStopTask = () => {
    if (userPromptResolverRef.current) {
      userPromptResolverRef.current('Aborted by user.');
      userPromptResolverRef.current = null;
    }
    setPendingQuestion(null);

    if (activeExecutionRef.current) {
      activeExecutionRef.current.abort();
      setLiveStatus('Aborted by user.');
      setIsRunning(false);
    }
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
            onStartTask={handleStartTask}
            onStopTask={handleStopTask}
            currentStep={currentStep}
            maxSteps={settings.agent.maxSteps}
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
          <HistoryView onRerunTask={handleRerun} />
        )}
      </main>
    </div>
  );
};
