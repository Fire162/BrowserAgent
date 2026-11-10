/**
 * BrowserAgent Background Service Worker
 * Manages tab operations, background agent execution, and persistent lifecycle
 */

import { AgentExecution, StepRecord, TargetTabInfo, BudgetLimitDecision } from '../core/agent/loop';
import { performTabNavigation, performTabScreenshot } from '../core/agent/tab-ops';
import { saveTask, TaskRecord } from '../core/storage/db';
import { PROVIDERS } from '../core/llm/providers/registry';
import { triggerNotification } from '../core/utils/notifications';
import { AllSettings } from '../core/llm/types';

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

export interface EngineState {
  isRunning: boolean;
  isPaused: boolean;
  currentStep: number;
  liveStatus: string;
  liveCostUSD: number;
  liveTokens: number;
  liveCachedTokens: number;
  turns: ChatTurn[];
  targetTab: TargetTabInfo | null;
  pendingQuestion: string | null;
  pendingBudgetLimit: BudgetLimitEvent | null;
  activeGoal: string | null;
  hasActiveSession: boolean;
}

let engineState: EngineState = {
  isRunning: false,
  isPaused: false,
  currentStep: 1,
  liveStatus: '',
  liveCostUSD: 0,
  liveTokens: 0,
  liveCachedTokens: 0,
  turns: [],
  targetTab: null,
  pendingQuestion: null,
  pendingBudgetLimit: null,
  activeGoal: null,
  hasActiveSession: false,
};

let activeExecution: AgentExecution | null = null;
let userPromptResolver: ((answer: string) => void) | null = null;
let budgetLimitResolver: ((decision: BudgetLimitDecision) => void) | null = null;

// Enable automatic side panel opening on extension icon click
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.error('[BrowserAgent Background] Failed to set side panel behavior:', err);
    });
  }
  console.log('[BrowserAgent] Extension installed & side panel configured.');
});

// Alarm listener to keep the background service worker awake during active tasks
chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === 'browseragent_keepalive') {
    chrome.storage.local.get(['_keepalive']).catch(() => {});
  }
});

function startKeepAlive() {
  try {
    chrome.alarms?.create('browseragent_keepalive', { periodInMinutes: 0.35 });
  } catch {
    // Ignore alarm errors
  }
}

function stopKeepAlive() {
  try {
    chrome.alarms?.clear('browseragent_keepalive');
  } catch {
    // Ignore alarm errors
  }
}

function broadcast(event: { type: string; [key: string]: any }) {
  try {
    chrome.runtime.sendMessage({ action: 'ENGINE_EVENT', event }).catch(() => {
      // Ignored if sidepanel is closed
    });
  } catch {
    // Ignored
  }
}

function finalizeSteps() {
  engineState.turns = engineState.turns.map((turn) => ({
    ...turn,
    status: turn.status === 'running' ? 'completed' : turn.status,
    steps: turn.steps.map((s) => ({
      ...s,
      status: s.status === 'running' ? (s.resultMessage?.includes('failed') ? 'failed' : 'success') : s.status,
    })),
  }));
}

async function runAgent(
  goal: string,
  settings: AllSettings,
  targetTabId?: number,
  followUpText?: string
) {
  const activeDef = PROVIDERS[settings.activeProvider];
  const activeConfig = settings.providers[settings.activeProvider];
  const currentModel = activeConfig?.customModelId || activeConfig?.selectedModel || activeDef?.defaultModel;

  // Handle follow-up resume
  if (followUpText && activeExecution) {
    const followUpTurn: ChatTurn = {
      id: `turn_${Date.now()}`,
      userPrompt: followUpText,
      timestamp: Date.now(),
      steps: [],
      resultSummary: null,
      status: 'running',
    };

    engineState.turns = [...engineState.turns, followUpTurn];
    engineState.isRunning = true;
    engineState.isPaused = false;
    engineState.liveStatus = 'Continuing task on assigned tab with follow-up...';
    broadcast({ type: 'STATUS_SYNC', state: engineState });
    startKeepAlive();

    try {
      const summary = await activeExecution.run(followUpText);
      const isPaused = activeExecution.isPaused();
      engineState.isRunning = false;
      engineState.isPaused = isPaused;
      engineState.liveStatus = isPaused ? 'Task paused. Enter follow-up instructions to resume.' : 'Task completed.';

      const lastIdx = engineState.turns.length - 1;
      if (lastIdx >= 0) {
        engineState.turns[lastIdx] = {
          ...engineState.turns[lastIdx],
          resultSummary: summary,
          status: isPaused ? 'paused' : 'completed',
        };
      }

      if (!isPaused) {
        await saveTask({
          id: `task_${Date.now()}`,
          goal: followUpText,
          provider: activeDef?.name || settings.activeProvider,
          model: currentModel,
          status: 'completed',
          stepCount: activeExecution.getSteps().length,
          resultSummary: summary,
          steps: activeExecution.getSteps(),
          messages: activeExecution.getMessages(),
          createdAt: Date.now(),
          completedAt: Date.now(),
        });

        triggerNotification('BrowserAgent: Task Completed', summary || 'The requested browser automation task has concluded.');
      }
    } catch (err: any) {
      engineState.isRunning = false;
      engineState.liveStatus = `Error: ${err.message}`;
      const lastIdx = engineState.turns.length - 1;
      if (lastIdx >= 0) {
        engineState.turns[lastIdx] = {
          ...engineState.turns[lastIdx],
          resultSummary: `Task terminated with error: ${err.message}`,
          status: 'failed',
        };
      }
      triggerNotification('BrowserAgent Task Failed', err.message);
    } finally {
      stopKeepAlive();
      finalizeSteps();
      broadcast({ type: 'STATUS_SYNC', state: engineState });
    }
    return;
  }

  // Handle fresh task
  const initialTurn: ChatTurn = {
    id: `turn_${Date.now()}`,
    userPrompt: goal,
    timestamp: Date.now(),
    steps: [],
    resultSummary: null,
    status: 'running',
  };

  engineState = {
    ...engineState,
    isRunning: true,
    isPaused: false,
    currentStep: 1,
    liveCostUSD: 0,
    liveTokens: 0,
    liveCachedTokens: 0,
    turns: [initialTurn],
    pendingQuestion: null,
    pendingBudgetLimit: null,
    activeGoal: goal,
    hasActiveSession: true,
    liveStatus: 'Initializing agent on assigned tab...',
  };
  broadcast({ type: 'STATUS_SYNC', state: engineState });
  startKeepAlive();

  const startTime = Date.now();

  const execution = new AgentExecution(
    settings,
    goal,
    {
      onStepStart: (num) => {
        engineState.currentStep = num;
        broadcast({ type: 'STEP_START', stepNumber: num });
      },
      onStepComplete: (step) => {
        if (engineState.turns.length > 0) {
          const lastIdx = engineState.turns.length - 1;
          const currentTurn = engineState.turns[lastIdx];
          const existingStepIdx = currentTurn.steps.findIndex((s) => s.stepNumber === step.stepNumber);
          let updatedSteps: StepRecord[];
          if (existingStepIdx >= 0) {
            updatedSteps = [...currentTurn.steps];
            updatedSteps[existingStepIdx] = { ...step };
          } else {
            updatedSteps = [...currentTurn.steps, step];
          }
          engineState.turns[lastIdx] = { ...currentTurn, steps: updatedSteps };
          broadcast({ type: 'STEP_COMPLETE', step, turns: engineState.turns });
        }
      },
      onCostUpdate: (cost, tokens, cached) => {
        engineState.liveCostUSD = cost;
        engineState.liveTokens = tokens;
        if (cached !== undefined) engineState.liveCachedTokens = cached;
        broadcast({ type: 'COST_UPDATE', cost, tokens, cached });
      },
      onLog: (msg) => {
        engineState.liveStatus = msg;
        broadcast({ type: 'LOG', message: msg });
      },
      onFinish: (summary) => {
        if (engineState.turns.length > 0) {
          const lastIdx = engineState.turns.length - 1;
          engineState.turns[lastIdx] = {
            ...engineState.turns[lastIdx],
            resultSummary: summary,
            status: 'completed',
          };
        }
        engineState.liveStatus = 'Task completed.';
        broadcast({ type: 'FINISH', summary, turns: engineState.turns });
      },
      onError: (err) => {
        engineState.liveStatus = `Error: ${err.message}`;
        broadcast({ type: 'ERROR', error: err.message });
      },
      onAskUser: (question: string) => {
        engineState.pendingQuestion = question;
        broadcast({ type: 'ASK_USER', question });
        return new Promise<string>((resolve) => {
          userPromptResolver = resolve;
        });
      },
      onBudgetLimitReached: (currentSpentUSD: number, currentCapUSD: number) => {
        engineState.pendingBudgetLimit = { currentSpentUSD, currentCapUSD };
        broadcast({ type: 'BUDGET_LIMIT', currentSpentUSD, currentCapUSD });
        return new Promise<BudgetLimitDecision>((resolve) => {
          budgetLimitResolver = resolve;
        });
      },
      onTargetTabChanged: (info) => {
        engineState.targetTab = info;
        broadcast({ type: 'TARGET_TAB_CHANGED', info });
      },
    },
    undefined,
    undefined,
    targetTabId
  );

  activeExecution = execution;

  try {
    const summary = await execution.run();
    const isPaused = execution.isPaused();
    engineState.isRunning = false;
    engineState.isPaused = isPaused;
    engineState.liveStatus = isPaused ? 'Task paused. Enter follow-up instructions to resume.' : 'Task completed.';

    if (engineState.turns.length > 0) {
      const lastIdx = engineState.turns.length - 1;
      engineState.turns[lastIdx] = {
        ...engineState.turns[lastIdx],
        resultSummary: summary,
        status: isPaused ? 'paused' : 'completed',
      };
    }

    if (!isPaused) {
      await saveTask({
        id: `task_${Date.now()}`,
        goal,
        provider: activeDef?.name || settings.activeProvider,
        model: currentModel,
        status: 'completed',
        stepCount: execution.getSteps().length,
        resultSummary: summary,
        steps: execution.getSteps(),
        messages: execution.getMessages(),
        createdAt: startTime,
        completedAt: Date.now(),
      });

      triggerNotification('BrowserAgent: Task Completed', summary || 'The requested browser automation task has concluded.');
    }
  } catch (err: any) {
    engineState.isRunning = false;
    engineState.liveStatus = `Error: ${err.message}`;
    if (engineState.turns.length > 0) {
      const lastIdx = engineState.turns.length - 1;
      engineState.turns[lastIdx] = {
        ...engineState.turns[lastIdx],
        resultSummary: `Task terminated with error: ${err.message}`,
        status: 'failed',
      };
    }

    await saveTask({
      id: `task_${Date.now()}`,
      goal,
      provider: activeDef?.name || settings.activeProvider,
      model: currentModel,
      status: 'failed',
      stepCount: execution.getSteps().length,
      resultSummary: err.message,
      steps: execution.getSteps(),
      messages: execution.getMessages(),
      createdAt: startTime,
      completedAt: Date.now(),
    });

    triggerNotification('BrowserAgent Task Failed', err.message);
  } finally {
    engineState.isRunning = false;
    engineState.pendingQuestion = null;
    stopKeepAlive();
    finalizeSteps();
    broadcast({ type: 'STATUS_SYNC', state: engineState });
  }
}

function resumeHistoryTask(task: TaskRecord, settings: AllSettings) {
  const historyTurn: ChatTurn = {
    id: `history_${task.createdAt}`,
    userPrompt: task.goal,
    timestamp: task.createdAt,
    steps: task.steps || [],
    resultSummary: task.resultSummary || null,
    status: task.status === 'completed' ? 'completed' : 'failed',
  };

  const loadedTurns = task.turns && task.turns.length > 0 ? task.turns : [historyTurn];
  engineState = {
    ...engineState,
    isRunning: false,
    isPaused: false,
    currentStep: (task.steps?.length || 0) + 1,
    liveStatus: `Loaded past task: "${task.goal.slice(0, 35)}...". Enter a follow-up to continue in this same chat.`,
    turns: loadedTurns,
    pendingQuestion: null,
    pendingBudgetLimit: null,
    activeGoal: task.goal,
    hasActiveSession: true,
  };

  activeExecution = new AgentExecution(
    settings,
    task.goal,
    {
      onStepStart: (num) => {
        engineState.currentStep = num;
        broadcast({ type: 'STEP_START', stepNumber: num });
      },
      onStepComplete: (step) => {
        if (engineState.turns.length > 0) {
          const lastIdx = engineState.turns.length - 1;
          const currentTurn = engineState.turns[lastIdx];
          const existingStepIdx = currentTurn.steps.findIndex((s) => s.stepNumber === step.stepNumber);
          let updatedSteps: StepRecord[];
          if (existingStepIdx >= 0) {
            updatedSteps = [...currentTurn.steps];
            updatedSteps[existingStepIdx] = { ...step };
          } else {
            updatedSteps = [...currentTurn.steps, step];
          }
          engineState.turns[lastIdx] = { ...currentTurn, steps: updatedSteps };
          broadcast({ type: 'STEP_COMPLETE', step, turns: engineState.turns });
        }
      },
      onCostUpdate: (cost, tokens, cached) => {
        engineState.liveCostUSD = cost;
        engineState.liveTokens = tokens;
        if (cached !== undefined) engineState.liveCachedTokens = cached;
        broadcast({ type: 'COST_UPDATE', cost, tokens, cached });
      },
      onLog: (msg) => {
        engineState.liveStatus = msg;
        broadcast({ type: 'LOG', message: msg });
      },
      onFinish: (summary) => {
        if (engineState.turns.length > 0) {
          const lastIdx = engineState.turns.length - 1;
          engineState.turns[lastIdx] = {
            ...engineState.turns[lastIdx],
            resultSummary: summary,
            status: 'completed',
          };
        }
        engineState.liveStatus = 'Task completed.';
        broadcast({ type: 'FINISH', summary, turns: engineState.turns });
      },
      onError: (err) => {
        engineState.liveStatus = `Error: ${err.message}`;
        broadcast({ type: 'ERROR', error: err.message });
      },
      onAskUser: (question: string) => {
        engineState.pendingQuestion = question;
        broadcast({ type: 'ASK_USER', question });
        return new Promise<string>((resolve) => {
          userPromptResolver = resolve;
        });
      },
      onBudgetLimitReached: (currentSpentUSD: number, currentCapUSD: number) => {
        engineState.pendingBudgetLimit = { currentSpentUSD, currentCapUSD };
        broadcast({ type: 'BUDGET_LIMIT', currentSpentUSD, currentCapUSD });
        return new Promise<BudgetLimitDecision>((resolve) => {
          budgetLimitResolver = resolve;
        });
      },
      onTargetTabChanged: (info) => {
        engineState.targetTab = info;
        broadcast({ type: 'TARGET_TAB_CHANGED', info });
      },
    },
    task.messages,
    task.steps,
    engineState.targetTab?.id
  );

  broadcast({ type: 'STATUS_SYNC', state: engineState });
}

// Message listener for tab management and background agent execution operations
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, params } = request || {};

  // 1. Get complete background engine state
  if (action === 'get_engine_state') {
    sendResponse({
      success: true,
      state: engineState,
      hasActiveSession: !!activeExecution || engineState.hasActiveSession,
    });
    return true;
  }

  // 2. Start a fresh task in background
  if (action === 'start_task') {
    const { goal, settings, targetTabId } = params || {};
    runAgent(goal, settings, targetTabId);
    sendResponse({ success: true });
    return true;
  }

  // 3. Resume task with follow-up
  if (action === 'resume_task') {
    const { followUpText, settings } = params || {};
    runAgent('', settings, undefined, followUpText);
    sendResponse({ success: true });
    return true;
  }

  // 4. Pause active task
  if (action === 'pause_task') {
    if (activeExecution) {
      activeExecution.pause();
      engineState.isPaused = true;
      engineState.liveStatus = 'Task paused. Enter follow-up instructions to resume.';
      broadcast({ type: 'STATUS_SYNC', state: engineState });
    }
    sendResponse({ success: true });
    return true;
  }

  // 5. Abort active task
  if (action === 'abort_task') {
    if (activeExecution) {
      activeExecution.abort();
      activeExecution = null;
    }
    engineState.isRunning = false;
    engineState.isPaused = false;
    engineState.liveStatus = 'Task stopped by user.';
    broadcast({ type: 'STATUS_SYNC', state: engineState });
    sendResponse({ success: true });
    return true;
  }

  // 6. Send live steering guidance
  if (action === 'send_steering') {
    const { message } = params || {};
    if (activeExecution && message?.trim()) {
      activeExecution.addSteeringMessage(message.trim());
      const lastIdx = engineState.turns.length - 1;
      if (lastIdx >= 0) {
        const currentTurn = engineState.turns[lastIdx];
        const existing = currentTurn.steeringMessages || [];
        engineState.turns[lastIdx] = {
          ...currentTurn,
          steeringMessages: [...existing, message.trim()],
        };
      }
      broadcast({ type: 'STATUS_SYNC', state: engineState });
    }
    sendResponse({ success: true });
    return true;
  }

  // 7. Answer pending user clarification
  if (action === 'answer_question') {
    const { answer } = params || {};
    if (userPromptResolver) {
      userPromptResolver(answer || 'Confirmed.');
      userPromptResolver = null;
    }
    engineState.pendingQuestion = null;
    broadcast({ type: 'STATUS_SYNC', state: engineState });
    sendResponse({ success: true });
    return true;
  }

  // 8. Resolve budget limit decision
  if (action === 'resolve_budget_limit') {
    const { decision } = params || {};
    if (budgetLimitResolver) {
      budgetLimitResolver(decision);
      budgetLimitResolver = null;
    }
    engineState.pendingBudgetLimit = null;
    broadcast({ type: 'STATUS_SYNC', state: engineState });
    sendResponse({ success: true });
    return true;
  }

  // 9. Reset chat session
  if (action === 'new_chat') {
    if (activeExecution) {
      activeExecution.abort();
      activeExecution = null;
    }
    if (budgetLimitResolver) {
      budgetLimitResolver({ action: 'conclude' });
      budgetLimitResolver = null;
    }
    userPromptResolver = null;
    engineState = {
      isRunning: false,
      isPaused: false,
      currentStep: 1,
      liveStatus: '',
      liveCostUSD: 0,
      liveTokens: 0,
      liveCachedTokens: 0,
      turns: [],
      targetTab: null,
      pendingQuestion: null,
      pendingBudgetLimit: null,
      activeGoal: null,
      hasActiveSession: false,
    };
    broadcast({ type: 'STATUS_SYNC', state: engineState });
    sendResponse({ success: true });
    return true;
  }

  // 10. Resume task loaded from History
  if (action === 'resume_history_task') {
    const { task, settings } = params || {};
    resumeHistoryTask(task, settings);
    sendResponse({ success: true });
    return true;
  }

  // 11. Retrieve full raw messages for JSON/MD export
  if (action === 'get_full_messages') {
    sendResponse({
      success: true,
      messages: activeExecution?.getMessages() || [],
    });
    return true;
  }

  // 12. Update target tab selection from UI
  if (action === 'set_target_tab') {
    const { tabInfo } = params || {};
    if (tabInfo) {
      engineState.targetTab = tabInfo;
      broadcast({ type: 'TARGET_TAB_CHANGED', info: tabInfo });
    }
    sendResponse({ success: true });
    return true;
  }

  // 13. Tab Navigation
  if (action === 'navigate_tab') {
    const { tabId, url } = params || {};
    performTabNavigation(tabId, url).then((res) => {
      sendResponse(res);
    });
    return true;
  }

  // 14. Tab Screenshot
  if (action === 'capture_screenshot') {
    const { tabId } = params || {};
    performTabScreenshot(tabId).then((res) => {
      sendResponse(res);
    });
    return true;
  }

  // 15. Content Script Injection check
  if (action === 'ensure_content_script') {
    const { tabId } = params || {};
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        chrome.scripting.executeScript(
          {
            target: { tabId },
            files: ['content.js'],
          },
          () => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ success: true, injected: true });
            }
          }
        );
      } else {
        sendResponse({ success: true, alreadyInjected: true });
      }
    });
    return true;
  }

  // 16. Desktop Notification
  if (action === 'show_notification') {
    const { title, message } = params || {};
    try {
      if (typeof chrome !== 'undefined' && chrome.notifications?.create) {
        chrome.notifications.create(
          `browseragent_notice_${Date.now()}`,
          {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: title || 'BrowserAgent',
            message: message || 'BrowserAgent needs your attention.',
            priority: 2,
            requireInteraction: true,
          },
          (notificationId) => {
            sendResponse({ success: true, notificationId });
          }
        );
        return true;
      }
    } catch (e: any) {
      sendResponse({ success: false, error: e?.message });
      return true;
    }
    sendResponse({ success: false, error: 'Notifications API unavailable' });
    return true;
  }
});

// Reopen sidepanel and focus window when user clicks any notification
if (typeof chrome !== 'undefined' && chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener(async () => {
    try {
      const win = await chrome.windows.getCurrent();
      if (win?.id) {
        await chrome.windows.update(win.id, { focused: true });
        if ((chrome as any).sidePanel?.open) {
          await (chrome as any).sidePanel.open({ windowId: win.id });
        }
      }
    } catch (e) {
      console.error('[BrowserAgent Background] Failed to open side panel on notification click:', e);
    }
  });
}
