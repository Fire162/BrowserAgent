import { AllSettings, ChatMessage, ToolCall } from '../llm/types';
import { executeLLMCall } from '../llm/client';
import { AGENT_TOOLS } from './tools';
import { SYSTEM_PROMPT } from './prompts';

export interface StepRecord {
  stepNumber: number;
  thought?: string;
  toolCall?: ToolCall;
  resultMessage?: string;
  timestamp: number;
  status: 'running' | 'success' | 'failed';
}

export interface AgentRunCallbacks {
  onStepStart?: (stepNumber: number) => void;
  onStepComplete?: (step: StepRecord) => void;
  onLog?: (message: string) => void;
  onFinish?: (summary: string) => void;
  onError?: (error: Error) => void;
  onAskUser?: (question: string) => Promise<string>;
}

export class AgentExecution {
  private aborted = false;

  constructor(
    private settings: AllSettings,
    private goal: string,
    private callbacks: AgentRunCallbacks = {}
  ) {}

  public abort(): void {
    this.aborted = true;
    this.callbacks.onLog?.('Stopping execution...');
  }

  private async getActiveTabId(): Promise<number> {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      throw new Error('Chrome extension tabs API is not available.');
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0 || !tabs[0].id) {
      throw new Error('No active browser tab found.');
    }
    return tabs[0].id;
  }

  private async ensureContentScript(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          chrome.scripting.executeScript(
            { target: { tabId }, files: ['content.js'] },
            () => resolve()
          );
        } else {
          resolve();
        }
      });
    });
  }

  private async getPageSnapshot(tabId: number, showVisualLabels: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        { action: 'get_snapshot', params: { showVisualLabels } },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (res && res.success) {
            resolve(res.data);
          } else {
            reject(new Error(res?.message || 'Failed to capture page snapshot.'));
          }
        }
      );
    });
  }

  private async executeDOMAction(tabId: number, toolName: string, args: Record<string, any>): Promise<any> {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        { action: 'perform_action', params: { toolName, args } },
        (res) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: true, message: 'Action sent.' });
          }
        }
      );
    });
  }

  private async clearBadges(tabId: number): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'clear_labels' });
    } catch {
      // Ignore cleanup error
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async run(): Promise<string> {
    let tabId = await this.getActiveTabId();
    await this.ensureContentScript(tabId);

    const maxSteps = this.settings.agent.maxSteps || 25;
    const showVisualLabels = this.settings.agent.showVisualLabels ?? true;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: this.settings.agent.systemPromptOverride || SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `TASK GOAL: ${this.goal}`,
      },
    ];

    let stepCounter = 1;

    try {
      while (stepCounter <= maxSteps) {
        if (this.aborted) {
          await this.clearBadges(tabId);
          return 'Execution aborted by user.';
        }

        this.callbacks.onStepStart?.(stepCounter);

        // Make sure active tab is still accessible
        tabId = await this.getActiveTabId();
        await this.ensureContentScript(tabId);

        // 1. Observe
        let snapshot: any;
        try {
          snapshot = await this.getPageSnapshot(tabId, showVisualLabels);
        } catch (err: any) {
          this.callbacks.onLog?.(`Retrying page observation: ${err.message}`);
          await this.sleep(1500);
          snapshot = await this.getPageSnapshot(tabId, showVisualLabels);
        }

        const elementsList = snapshot.snapshotText
          ? snapshot.snapshotText.slice(0, 8000)
          : 'No visible interactive elements detected.';

        const observationContent = `[CURRENT PAGE OBSERVATION]
URL: ${snapshot.url}
Title: ${snapshot.title}
Interactive Elements:
${elementsList}

What is your next action?`;

        messages.push({
          role: 'user',
          content: observationContent,
        });

        // 2. Reason (Call LLM)
        this.callbacks.onLog?.(`Thinking with ${this.settings.activeProvider}...`);
        const response = await executeLLMCall(this.settings, messages, AGENT_TOOLS);

        const thought = response.text?.trim() || '';
        const toolCalls = response.toolCalls || [];

        if (toolCalls.length === 0) {
          const stepRecord: StepRecord = {
            stepNumber: stepCounter,
            thought,
            timestamp: Date.now(),
            status: 'success',
            resultMessage: 'Agent reflected without dispatching a tool.',
          };
          this.callbacks.onStepComplete?.(stepRecord);

          messages.push({
            role: 'assistant',
            content: thought,
          });

          stepCounter++;
          continue;
        }

        // Execute primary tool call
        const primaryTool = toolCalls[0];
        const stepRecord: StepRecord = {
          stepNumber: stepCounter,
          thought,
          toolCall: primaryTool,
          timestamp: Date.now(),
          status: 'running',
        };

        // 3. Act
        let toolResultStr = '';

        if (primaryTool.name === 'finish') {
          const summary = primaryTool.arguments.summary || thought || 'Task marked complete.';
          stepRecord.status = 'success';
          stepRecord.resultMessage = 'Task finished.';
          this.callbacks.onStepComplete?.(stepRecord);
          await this.clearBadges(tabId);
          this.callbacks.onFinish?.(summary);
          return summary;
        }

        if (primaryTool.name === 'ask_user') {
          const question = primaryTool.arguments.question || 'Clarification needed from user.';
          stepRecord.status = 'running';
          stepRecord.resultMessage = `Waiting for user: "${question}"`;
          this.callbacks.onStepComplete?.(stepRecord);
          this.callbacks.onLog?.('Awaiting your input...');

          let userReply = 'Confirmed. Please proceed.';
          if (this.callbacks.onAskUser) {
            userReply = await this.callbacks.onAskUser(question);
          }

          if (this.aborted) {
            await this.clearBadges(tabId);
            return 'Execution aborted by user.';
          }

          stepRecord.status = 'success';
          stepRecord.resultMessage = `User replied: "${userReply}"`;
          this.callbacks.onStepComplete?.(stepRecord);
          this.callbacks.onLog?.('Resuming task with your response...');

          toolResultStr = `User responded: "${userReply}". Please proceed with the next step.`;
        } else if (primaryTool.name === 'wait') {
          const secs = Math.min(10, Math.max(1, parseInt(primaryTool.arguments.seconds || '2', 10)));
          this.callbacks.onLog?.(`Waiting ${secs}s for page update...`);
          await this.sleep(secs * 1000);
          toolResultStr = `Waited for ${secs} seconds.`;
        } else if (primaryTool.name === 'navigate') {
          const url = primaryTool.arguments.url;
          this.callbacks.onLog?.(`Navigating to ${url}...`);
          await new Promise<void>((resolve) => {
            chrome.runtime.sendMessage({ action: 'navigate_tab', params: { tabId, url } }, () => {
              setTimeout(resolve, 2000);
            });
          });
          toolResultStr = `Navigated to ${url}.`;
        } else {
          // DOM actions: click, type, press_key, scroll, extract_data
          const domRes = await this.executeDOMAction(tabId, primaryTool.name, primaryTool.arguments);
          toolResultStr = domRes.message || JSON.stringify(domRes);
          if (!domRes.success) {
            stepRecord.status = 'failed';
          } else {
            stepRecord.status = 'success';
          }
        }

        stepRecord.resultMessage = toolResultStr;
        this.callbacks.onStepComplete?.(stepRecord);

        // Append assistant tool call and tool result to conversation
        messages.push({
          role: 'assistant',
          content: thought,
          toolCalls: [primaryTool],
        });

        messages.push({
          role: 'tool',
          toolCallId: primaryTool.id || `call_${stepCounter}`,
          content: toolResultStr,
        });

        // Small delay between steps
        await this.sleep(800);
        stepCounter++;
      }

      await this.clearBadges(tabId);
      const limitReached = `Reached maximum step limit (${maxSteps}). Please inspect results or continue with a follow-up prompt.`;
      this.callbacks.onFinish?.(limitReached);
      return limitReached;
    } catch (err: any) {
      await this.clearBadges(tabId);
      this.callbacks.onError?.(err);
      throw err;
    }
  }
}
