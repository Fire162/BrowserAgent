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
  costUSD?: number;
  screenshotUrl?: string;
}

export interface AgentRunCallbacks {
  onStepStart?: (stepNumber: number) => void;
  onStepComplete?: (step: StepRecord) => void;
  onLog?: (message: string) => void;
  onFinish?: (summary: string) => void;
  onError?: (error: Error) => void;
  onAskUser?: (question: string) => Promise<string>;
  onCostUpdate?: (costUSD: number, totalTokens: number) => void;
}

export class AgentExecution {
  private aborted = false;
  private paused = false;
  private completed = false;
  private steeringQueue: string[] = [];
  private messages: ChatMessage[] = [];
  private stepCounter = 1;
  private accumulatedCostUSD = 0;
  private accumulatedTokens = 0;
  private recordedSteps: StepRecord[] = [];

  constructor(
    private settings: AllSettings,
    private goal: string,
    private callbacks: AgentRunCallbacks = {},
    initialMessages?: ChatMessage[],
    initialSteps?: StepRecord[]
  ) {
    if (initialMessages && initialMessages.length > 0) {
      this.messages = [...initialMessages];
    } else {
      this.messages = [
        {
          role: 'system',
          content: this.settings.agent.systemPromptOverride || SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: `TASK GOAL: ${this.goal}`,
        },
      ];
    }

    if (initialSteps && initialSteps.length > 0) {
      this.recordedSteps = [...initialSteps];
      this.stepCounter = initialSteps.length + 1;
    }
  }

  public abort(): void {
    this.aborted = true;
    this.paused = false;
    this.callbacks.onLog?.('Task stopped by user.');
  }

  public pause(): void {
    this.paused = true;
    this.callbacks.onLog?.('Task paused. Awaiting follow-up instruction...');
  }

  public addSteeringMessage(msg: string): void {
    if (msg.trim()) {
      this.steeringQueue.push(msg.trim());
      this.callbacks.onLog?.(`Steering queued: "${msg.trim().slice(0, 30)}..."`);
    }
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public isAborted(): boolean {
    return this.aborted;
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public getSteps(): StepRecord[] {
    return [...this.recordedSteps];
  }

  public getCost(): number {
    return this.accumulatedCostUSD;
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

  public async run(followUpInstruction?: string): Promise<string> {
    this.aborted = false;
    this.paused = false;

    let tabId = await this.getActiveTabId();
    await this.ensureContentScript(tabId);

    let maxBudgetUSD = this.settings.agent.maxBudgetUSD ?? 0.25;
    const showVisualLabels = this.settings.agent.showVisualLabels ?? true;

    if (followUpInstruction && followUpInstruction.trim()) {
      this.messages.push({
        role: 'user',
        content: `[USER FOLLOW-UP INSTRUCTION]:\n${followUpInstruction.trim()}`,
      });
      this.callbacks.onLog?.('Resuming with your follow-up instruction...');
    }

    try {
      while (true) {
        if (this.aborted) {
          await this.clearBadges(tabId);
          return 'Execution stopped by user.';
        }

        if (this.paused) {
          await this.clearBadges(tabId);
          return 'Execution paused. Enter follow-up instructions to resume.';
        }

        // Budget check: If budget cap is set and exceeded, pause and ask user
        if (maxBudgetUSD > 0 && this.accumulatedCostUSD >= maxBudgetUSD) {
          this.callbacks.onLog?.(`Budget limit reached ($${maxBudgetUSD.toFixed(2)}). Asking for approval...`);
          
          const budgetPrompt = `Budget cap of $${maxBudgetUSD.toFixed(2)} reached (Current spend: $${this.accumulatedCostUSD.toFixed(4)}). Would you like to add more budget and proceed, or conclude the task?`;
          let userResponse = 'continue';

          if (this.callbacks.onAskUser) {
            userResponse = await this.callbacks.onAskUser(budgetPrompt);
          }

          if (this.aborted || this.paused) {
            await this.clearBadges(tabId);
            return 'Execution stopped by user.';
          }

          const lower = userResponse.toLowerCase();
          if (lower.includes('stop') || lower.includes('cancel') || lower.includes('finish') || lower.includes('conclude')) {
            await this.clearBadges(tabId);
            const budgetStopMsg = `Task concluded at budget limit of $${maxBudgetUSD.toFixed(2)} (Spent: $${this.accumulatedCostUSD.toFixed(4)}).`;
            this.callbacks.onFinish?.(budgetStopMsg);
            return budgetStopMsg;
          }

          maxBudgetUSD += 0.25;
          this.callbacks.onLog?.(`Budget extended to $${maxBudgetUSD.toFixed(2)}. Resuming...`);
        }

        this.callbacks.onStepStart?.(this.stepCounter);

        // Make sure active tab is still accessible
        tabId = await this.getActiveTabId();
        await this.ensureContentScript(tabId);

        // 1. Observe DOM
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

        let observationContent = `[CURRENT PAGE OBSERVATION]
URL: ${snapshot.url}
Title: ${snapshot.title}
Interactive Elements:
${elementsList}

What is your next action?`;

        // Check if user submitted mid-flight steering message
        if (this.steeringQueue.length > 0) {
          const guidance = this.steeringQueue.splice(0, this.steeringQueue.length).join('\n');
          observationContent += `\n\n[USER REAL-TIME GUIDANCE / STEERING MESSAGE]:\n"${guidance}"\nCRITICAL: You must incorporate this user instruction immediately for your next action.`;
          this.callbacks.onLog?.(`Applied user guidance: "${guidance.slice(0, 30)}..."`);
        }

        this.messages.push({
          role: 'user',
          content: observationContent,
        });

        // 2. Reason (Call LLM with resilient 429 backoff)
        this.callbacks.onLog?.(`Thinking with ${this.settings.activeProvider}...`);
        
        const response = await executeLLMCall(
          this.settings,
          this.messages,
          AGENT_TOOLS,
          (retryNotice) => this.callbacks.onLog?.(retryNotice)
        );

        // Track spending and tokens
        if (response.estimatedCostUSD) {
          this.accumulatedCostUSD += response.estimatedCostUSD;
        }
        if (response.usage?.totalTokens) {
          this.accumulatedTokens += response.usage.totalTokens;
        }
        this.callbacks.onCostUpdate?.(this.accumulatedCostUSD, this.accumulatedTokens);

        const thought = response.text?.trim() || '';
        const toolCalls = response.toolCalls || [];

        if (toolCalls.length === 0) {
          const stepRecord: StepRecord = {
            stepNumber: this.stepCounter,
            thought,
            timestamp: Date.now(),
            status: 'success',
            resultMessage: 'Agent reflected without dispatching a tool.',
            costUSD: response.estimatedCostUSD,
          };
          this.recordedSteps.push(stepRecord);
          this.callbacks.onStepComplete?.(stepRecord);

          this.messages.push({
            role: 'assistant',
            content: thought,
          });

          this.stepCounter++;
          continue;
        }

        // Execute primary tool call
        const primaryTool = toolCalls[0];
        const stepRecord: StepRecord = {
          stepNumber: this.stepCounter,
          thought,
          toolCall: primaryTool,
          timestamp: Date.now(),
          status: 'running',
          costUSD: response.estimatedCostUSD,
        };

        // 3. Act
        let toolResultStr = '';

        if (primaryTool.name === 'finish') {
          const summary = primaryTool.arguments.summary || thought || 'Task marked complete.';
          stepRecord.status = 'success';
          stepRecord.resultMessage = 'Task finished.';
          this.recordedSteps.push(stepRecord);
          this.callbacks.onStepComplete?.(stepRecord);
          await this.clearBadges(tabId);
          this.completed = true;
          this.callbacks.onFinish?.(summary);
          return summary;
        }

        if (primaryTool.name === 'take_screenshot') {
          this.callbacks.onLog?.('Capturing visible tab screenshot...');
          const shotRes = await new Promise<any>((resolve) => {
            chrome.runtime.sendMessage({ action: 'capture_screenshot' }, (res) => {
              resolve(res || {});
            });
          });

          if (shotRes?.success && shotRes?.dataUrl) {
            stepRecord.screenshotUrl = shotRes.dataUrl;
            toolResultStr = 'Screenshot captured successfully and attached to report.';
            stepRecord.status = 'success';
          } else {
            toolResultStr = `Screenshot capture failed: ${shotRes?.error || 'Unknown error'}`;
            stepRecord.status = 'failed';
          }
        } else if (primaryTool.name === 'ask_user') {
          const question = primaryTool.arguments.question || 'Clarification needed from user.';
          stepRecord.status = 'running';
          stepRecord.resultMessage = `Waiting for user: "${question}"`;
          this.callbacks.onStepComplete?.(stepRecord);
          this.callbacks.onLog?.('Awaiting your input...');

          let userReply = 'Confirmed. Please proceed.';
          if (this.callbacks.onAskUser) {
            userReply = await this.callbacks.onAskUser(question);
          }

          if (this.aborted || this.paused) {
            await this.clearBadges(tabId);
            return 'Execution paused by user.';
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
          const domRes = await this.executeDOMAction(tabId, primaryTool.name, primaryTool.arguments);
          toolResultStr = domRes.message || JSON.stringify(domRes);
          if (!domRes.success) {
            stepRecord.status = 'failed';
          } else {
            stepRecord.status = 'success';
          }
        }

        stepRecord.resultMessage = toolResultStr;
        this.recordedSteps.push(stepRecord);
        this.callbacks.onStepComplete?.(stepRecord);

        // Append assistant tool call and tool result to conversation
        this.messages.push({
          role: 'assistant',
          content: thought,
          toolCalls: [primaryTool],
        });

        this.messages.push({
          role: 'tool',
          toolCallId: primaryTool.id || `call_${this.stepCounter}`,
          content: toolResultStr,
        });

        await this.sleep(800);
        this.stepCounter++;
      }
    } catch (err: any) {
      await this.clearBadges(tabId);
      this.callbacks.onError?.(err);
      throw err;
    }
  }
}
