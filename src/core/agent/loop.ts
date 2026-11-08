import { AllSettings, ChatMessage, ToolCall } from '../llm/types';
import { executeLLMCall } from '../llm/client';
import { AGENT_TOOLS } from './tools';
import { SYSTEM_PROMPT } from './prompts';

export interface TargetTabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface StepRecord {
  stepNumber: number;
  thought?: string;
  toolCall?: ToolCall;
  toolCalls?: ToolCall[];
  resultMessage?: string;
  timestamp: number;
  status: 'running' | 'success' | 'failed';
  costUSD?: number;
  screenshotUrl?: string;
  cachedTokens?: number;
}

export interface AgentRunCallbacks {
  onStepStart?: (stepNumber: number) => void;
  onStepComplete?: (step: StepRecord) => void;
  onLog?: (message: string) => void;
  onFinish?: (summary: string) => void;
  onError?: (error: Error) => void;
  onAskUser?: (question: string) => Promise<string>;
  onCostUpdate?: (costUSD: number, totalTokens: number, cachedTokens?: number) => void;
  onTargetTabChanged?: (tabInfo: TargetTabInfo) => void;
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
  private accumulatedCachedTokens = 0;
  private recordedSteps: StepRecord[] = [];
  private pendingScreenshotUrl?: string;
  private targetTabId?: number;
  private targetTabInfo?: TargetTabInfo;
  private abortController = new AbortController();

  constructor(
    private settings: AllSettings,
    private goal: string,
    private callbacks: AgentRunCallbacks = {},
    initialMessages?: ChatMessage[],
    initialSteps?: StepRecord[],
    assignedTabId?: number
  ) {
    this.targetTabId = assignedTabId;

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
    this.abortController.abort();
    this.callbacks.onLog?.('Task stopped by user.');
  }

  public pause(): void {
    this.paused = true;
    this.abortController.abort();
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

  public getTargetTabId(): number | undefined {
    return this.targetTabId;
  }

  public getTargetTabInfo(): TargetTabInfo | undefined {
    return this.targetTabInfo;
  }

  private async getActiveTab(): Promise<chrome.tabs.Tab> {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      throw new Error('Chrome extension tabs API is not available.');
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0 || !tabs[0].id) {
      throw new Error('No active browser tab found.');
    }
    return tabs[0];
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

  private async clearBadges(tabId?: number): Promise<void> {
    if (!tabId) return;
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'clear_labels' });
    } catch {
      // Ignore cleanup error if tab closed
    }
  }

  /**
   * Prunes past bulky DOM observations and visual screenshots from older steps.
   * Keeps the latest live observation intact while replacing older DOM listings with compact stubs.
   * This keeps token consumption flat across steps and maximizes prompt cache hits.
   */
  private pruneHistoricalMessages(): void {
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];

      // 1. Remove past base64 screenshot data (model already inspected and acted on it)
      if (msg.imageUrl) {
        msg.imageUrl = undefined;
      }

      // 2. Condense past DOM observations into a lightweight 2-line stub
      if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('[CURRENT PAGE OBSERVATION]')) {
        const urlMatch = msg.content.match(/URL:\s*([^\n]+)/);
        const titleMatch = msg.content.match(/Title:\s*([^\n]+)/);
        const url = urlMatch ? urlMatch[1] : '';
        const title = titleMatch ? titleMatch[1] : '';

        const guidanceMatch = msg.content.match(/\[USER REAL-TIME GUIDANCE \/ STEERING MESSAGE\]:\n"([^"]+)"/);
        const guidanceText = guidanceMatch ? `\n[Steering Applied]: "${guidanceMatch[1]}"` : '';

        msg.content = `[HISTORICAL STEP OBSERVATION]\nPage: ${title} (${url})${guidanceText}\n(DOM elements list omitted from history to conserve tokens; live elements provided in latest observation)`;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async run(followUpInstruction?: string): Promise<string> {
    this.aborted = false;
    this.paused = false;
    this.abortController = new AbortController();

    // 1. Lock Target Tab ID so user can multi-task on other tabs without disruption
    if (!this.targetTabId) {
      const activeTab = await this.getActiveTab();
      this.targetTabId = activeTab.id!;
      this.targetTabInfo = {
        id: activeTab.id!,
        title: activeTab.title || 'Active Tab',
        url: activeTab.url || '',
        favIconUrl: activeTab.favIconUrl,
      };
    }

    // Verify assigned tab is open
    try {
      const tab = await chrome.tabs.get(this.targetTabId);
      this.targetTabInfo = {
        id: tab.id!,
        title: tab.title || 'Tab #' + tab.id,
        url: tab.url || '',
        favIconUrl: tab.favIconUrl,
      };
      this.callbacks.onTargetTabChanged?.(this.targetTabInfo);
    } catch {
      return `Target tab #${this.targetTabId} was closed or not found.`;
    }

    const tabId = this.targetTabId;
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

        // Check if assigned tab is still alive
        try {
          const tab = await chrome.tabs.get(tabId);
          this.targetTabInfo = {
            id: tab.id!,
            title: tab.title || 'Tab #' + tab.id,
            url: tab.url || '',
            favIconUrl: tab.favIconUrl,
          };
          this.callbacks.onTargetTabChanged?.(this.targetTabInfo);
        } catch {
          await this.clearBadges(tabId);
          const closedMsg = `Target tab #${tabId} was closed. Execution concluded.`;
          this.callbacks.onFinish?.(closedMsg);
          return closedMsg;
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
        await this.ensureContentScript(tabId);

        // Prune past bulky DOM observations and past images to keep tokens flat and maximize server prompt caching
        this.pruneHistoricalMessages();

        // 1. Observe DOM on the assigned target tab
        let snapshot: any;
        try {
          snapshot = await this.getPageSnapshot(tabId, showVisualLabels);
        } catch (err: any) {
          this.callbacks.onLog?.(`Retrying page observation on tab #${tabId}: ${err.message}`);
          await this.sleep(1500);
          snapshot = await this.getPageSnapshot(tabId, showVisualLabels);
        }

        let elementsList = snapshot.snapshotText || 'No visible interactive elements detected.';
        // Clean line-based slicing if elements list exceeds 6000 characters
        if (elementsList.length > 6000) {
          const cutIdx = elementsList.lastIndexOf('\n', 6000);
          elementsList = (cutIdx > 0 ? elementsList.slice(0, cutIdx) : elementsList.slice(0, 6000)) + '\n... [Remaining elements truncated; scroll to view more]';
        }

        let observationContent = `[CURRENT PAGE OBSERVATION]
Tab ID: ${tabId}
URL: ${snapshot.url}
Title: ${snapshot.title}
Interactive Elements:
${elementsList}

What is your next action?`;

        let currentObservationImageUrl: string | undefined = undefined;
        if (this.pendingScreenshotUrl) {
          currentObservationImageUrl = this.pendingScreenshotUrl;
          observationContent += `\n\n[SCREENSHOT IMAGE ATTACHED]: A visual screenshot of the assigned tab's visible viewport is attached to this message for your visual analysis.`;
          this.pendingScreenshotUrl = undefined;
        }

        // Check if user submitted mid-flight steering message
        if (this.steeringQueue.length > 0) {
          const guidance = this.steeringQueue.splice(0, this.steeringQueue.length).join('\n');
          observationContent += `\n\n[USER REAL-TIME GUIDANCE / STEERING MESSAGE]:\n"${guidance}"\nCRITICAL: You must incorporate this user instruction immediately for your next action.`;
          this.callbacks.onLog?.(`Applied user guidance: "${guidance.slice(0, 30)}..."`);
        }

        this.messages.push({
          role: 'user',
          content: observationContent,
          imageUrl: currentObservationImageUrl,
        });

        // 2. Reason (Call LLM with resilient 429 backoff and AbortController signal)
        this.callbacks.onLog?.(`Thinking with ${this.settings.activeProvider}...`);
        
        let response;
        try {
          response = await executeLLMCall(
            this.settings,
            this.messages,
            AGENT_TOOLS,
            (retryNotice) => this.callbacks.onLog?.(retryNotice),
            this.abortController.signal
          );
        } catch (callErr: any) {
          if (this.aborted || this.paused || callErr.name === 'AbortError') {
            await this.clearBadges(tabId);
            return this.aborted ? 'Execution stopped by user.' : 'Execution paused.';
          }
          throw callErr;
        }

        // Track spending, tokens, and prompt cache hits
        if (response.estimatedCostUSD) {
          this.accumulatedCostUSD += response.estimatedCostUSD;
        }
        if (response.usage?.totalTokens) {
          this.accumulatedTokens += response.usage.totalTokens;
        }
        if (response.usage?.cachedTokens) {
          this.accumulatedCachedTokens += response.usage.cachedTokens;
        }
        this.callbacks.onCostUpdate?.(
          this.accumulatedCostUSD,
          this.accumulatedTokens,
          this.accumulatedCachedTokens
        );

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
            cachedTokens: response.usage?.cachedTokens,
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

        // 3. Act: Multi-Action Batch Execution (Execute all tools in sequence)
        const stepRecord: StepRecord = {
          stepNumber: this.stepCounter,
          thought,
          toolCall: toolCalls[0],
          toolCalls: toolCalls,
          timestamp: Date.now(),
          status: 'running',
          costUSD: response.estimatedCostUSD,
          cachedTokens: response.usage?.cachedTokens,
        };

        const executedResults: { id: string; name: string; resultStr: string; imageUrl?: string }[] = [];
        let shouldFinish = false;
        let finishSummary = '';

        for (let i = 0; i < toolCalls.length; i++) {
          const currentTool = toolCalls[i];
          const toolCallId = currentTool.id || `call_${this.stepCounter}_${i}`;

          if (this.aborted || this.paused) {
            await this.clearBadges(tabId);
            return this.aborted ? 'Execution stopped by user.' : 'Execution paused.';
          }

          if (currentTool.name === 'finish') {
            finishSummary = currentTool.arguments.summary || thought || 'Task marked complete.';
            shouldFinish = true;
            executedResults.push({
              id: toolCallId,
              name: 'finish',
              resultStr: 'Task completed.',
            });
            break;
          }

          if (currentTool.name === 'take_screenshot') {
            this.callbacks.onLog?.('Capturing tab screenshot...');
            const shotRes = await new Promise<any>((resolve) => {
              chrome.runtime.sendMessage({ action: 'capture_screenshot', params: { tabId } }, (res) => {
                resolve(res || {});
              });
            });

            if (shotRes?.success && shotRes?.dataUrl) {
              stepRecord.screenshotUrl = shotRes.dataUrl;
              this.pendingScreenshotUrl = shotRes.dataUrl;
              executedResults.push({
                id: toolCallId,
                name: 'take_screenshot',
                resultStr: 'Screenshot captured successfully. Visual screenshot image is provided directly to you in the observation.',
                imageUrl: shotRes.dataUrl,
              });
            } else {
              executedResults.push({
                id: toolCallId,
                name: 'take_screenshot',
                resultStr: `Screenshot capture failed: ${shotRes?.error || 'Unknown error'}`,
              });
            }
          } else if (currentTool.name === 'ask_user') {
            const question = currentTool.arguments.question || 'Clarification needed from user.';
            stepRecord.resultMessage = `Waiting for user: "${question}"`;
            this.callbacks.onStepComplete?.(stepRecord);
            this.callbacks.onLog?.('Awaiting your input...');

            let userReply = 'Confirmed. Please proceed.';
            if (this.callbacks.onAskUser) {
              userReply = await this.callbacks.onAskUser(question);
            }

            if (this.aborted || this.paused) {
              await this.clearBadges(tabId);
              return this.aborted ? 'Execution stopped by user.' : 'Execution paused.';
            }

            executedResults.push({
              id: toolCallId,
              name: 'ask_user',
              resultStr: `User responded: "${userReply}". Please proceed with the next step.`,
            });
          } else if (currentTool.name === 'wait') {
            const secs = Math.min(10, Math.max(1, parseInt(currentTool.arguments.seconds || '2', 10)));
            this.callbacks.onLog?.(`Waiting ${secs}s...`);
            await this.sleep(secs * 1000);
            executedResults.push({
              id: toolCallId,
              name: 'wait',
              resultStr: `Waited for ${secs} seconds.`,
            });
          } else if (currentTool.name === 'navigate') {
            const url = currentTool.arguments.url;
            this.callbacks.onLog?.(`Navigating tab #${tabId} to ${url}...`);
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ action: 'navigate_tab', params: { tabId, url } }, () => {
                setTimeout(resolve, 2000);
              });
            });
            executedResults.push({
              id: toolCallId,
              name: 'navigate',
              resultStr: `Navigated to ${url}.`,
            });
          } else {
            const domRes = await this.executeDOMAction(tabId, currentTool.name, currentTool.arguments);
            executedResults.push({
              id: toolCallId,
              name: currentTool.name,
              resultStr: domRes.message || JSON.stringify(domRes),
            });
          }
        }

        const combinedResultStr = executedResults.map((r) => `[${r.name}] ${r.resultStr}`).join('\n');
        stepRecord.status = executedResults.some((r) => r.resultStr.includes('failed') || r.resultStr.includes('Could not find')) ? 'failed' : 'success';
        stepRecord.resultMessage = combinedResultStr;
        this.recordedSteps.push(stepRecord);
        this.callbacks.onStepComplete?.(stepRecord);

        // Append assistant tool calls and matching tool result messages
        this.messages.push({
          role: 'assistant',
          content: thought,
          toolCalls: toolCalls.slice(0, executedResults.length),
        });

        for (const r of executedResults) {
          this.messages.push({
            role: 'tool',
            toolCallId: r.id,
            content: r.resultStr,
            imageUrl: r.imageUrl,
          });
        }

        if (shouldFinish) {
          await this.clearBadges(tabId);
          this.completed = true;
          this.callbacks.onFinish?.(finishSummary);
          return finishSummary;
        }

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
