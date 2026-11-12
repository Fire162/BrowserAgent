import { AllSettings, ChatMessage, ToolCall } from '../llm/types';
import { executeLLMCall } from '../llm/client';
import { AGENT_TOOLS } from './tools';
import { SYSTEM_PROMPT } from './prompts';
import { triggerNotification, notifyToolbarBadge } from '../utils/notifications';
import { performTabNavigation, performTabScreenshot, detectHttpOrBrowserError, HttpOrBrowserError } from './tab-ops';

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
  steeringApplied?: string;
}

export interface BudgetLimitDecision {
  action: 'extend' | 'conclude';
  newBudgetUSD?: number;
}

export interface AgentRunCallbacks {
  onStepStart?: (stepNumber: number) => void;
  onStepComplete?: (step: StepRecord) => void;
  onLog?: (message: string) => void;
  onFinish?: (summary: string) => void;
  onError?: (error: Error) => void;
  onAskUser?: (question: string) => Promise<string>;
  onBudgetLimitReached?: (currentSpentUSD: number, currentCapUSD: number) => Promise<BudgetLimitDecision>;
  onCostUpdate?: (costUSD: number, totalTokens: number, cachedTokens?: number) => void;
  onTargetTabChanged?: (tabInfo: TargetTabInfo) => void;
}

export interface ActionRecord {
  toolName: string;
  argsKey: string;
  stepNumber: number;
  resultStr: string;
  failed: boolean;
}

function getToolCallKey(toolName: string, args: Record<string, any>): string {
  const keys = Object.keys(args || {}).sort();
  const sortedArgs: Record<string, any> = {};
  for (const k of keys) {
    if (args[k] !== undefined && args[k] !== null && String(args[k]).trim() !== '') {
      sortedArgs[k] = args[k];
    }
  }
  return `${toolName}::${JSON.stringify(sortedArgs)}`;
}

function isToolResultFailed(resultStr: string): boolean {
  const lower = resultStr.toLowerCase();
  return (
    lower.includes('failed') ||
    lower.includes('could not find') ||
    lower.includes('cannot scroll') ||
    lower.includes('blocked') ||
    lower.includes('error') ||
    lower.includes('does not exist') ||
    lower.includes('unable to') ||
    lower.includes('invalid')
  );
}

export class AgentExecution {
  private aborted = false;
  private paused = false;
  private completed = false;
  private steeringQueue: string[] = [];
  private lastSteeringInstruction?: string;
  private sleepResolve?: () => void;
  private actionHistory: ActionRecord[] = [];
  private consecutiveFailures = 0;
  private lastFailedAction?: { toolName: string; argsKey: string; resultStr: string };
  private activeSteeringForStep?: string;
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
      const trimmed = msg.trim();
      this.steeringQueue.push(trimmed);
      this.lastSteeringInstruction = trimmed;
      this.callbacks.onLog?.(`⚡ Priority steering queued: "${trimmed.slice(0, 30)}..."`);
      if (this.sleepResolve) {
        this.callbacks.onLog?.('⚡ Interrupting wait to apply live steering immediately...');
        this.sleepResolve();
      }
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

  public getTokens(): number {
    return this.accumulatedTokens;
  }

  public getCachedTokens(): number {
    return this.accumulatedCachedTokens;
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

    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs || tabs.length === 0 || !tabs[0].id) {
      tabs = await chrome.tabs.query({ active: true });
    }
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
    // 1. Inspect tab metadata
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      // Ignore tab get error
    }

    const tabUrl = tab?.url || '';
    const tabTitle = tab?.title || '';

    // 2. Detect unscriptable browser/internal error pages (Edge, Chrome, neterror)
    const earlyError = detectHttpOrBrowserError(tabUrl, tabTitle, '');
    if (
      tabUrl.startsWith('chrome-error://') ||
      tabUrl.startsWith('edge-error://') ||
      tabUrl.startsWith('about:neterror') ||
      tabUrl.startsWith('edge://') ||
      tabUrl.startsWith('chrome://') ||
      earlyError.type === 'DNS / Connection Failure'
    ) {
      return {
        url: tabUrl,
        title: tabTitle || "Site can't be reached",
        elements: [],
        snapshotText: `[PAGE LOAD / NETWORK ERROR]: ${earlyError.type || 'Connection Failure'} - ${earlyError.detail || 'The page cannot be reached.'}
URL: ${tabUrl}
Title: ${tabTitle || "Site can't be reached"}
Directive for Agent: The page returned a network/browser error and cannot load elements. Pivot immediately: navigate to a search engine (like google.com or bing.com) or an alternate URL.`,
        bodySnippet: tabTitle || "Site can't be reached",
        isErrorPage: true,
        errorInfo: earlyError,
      };
    }

    // 3. Request snapshot from content script with timeout
    let contentRes: any = null;
    try {
      contentRes = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Content script request timed out'));
        }, 3500);

        chrome.tabs.sendMessage(
          tabId,
          { action: 'get_snapshot', params: { showVisualLabels } },
          (res) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res && res.success) {
              resolve(res.data);
            } else {
              reject(new Error(res?.message || 'Invalid snapshot response'));
            }
          }
        );
      });
    } catch (msgErr: any) {
      // Content script messaging failed. Attempt direct script execution fallback.
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const title = document.title || '';
            const url = window.location.href;
            const body = (document.body ? document.body.innerText : (document.documentElement ? document.documentElement.innerText : '')) || '';
            return {
              title,
              url,
              bodySnippet: body.slice(0, 1500),
            };
          },
        });

        if (injected && injected[0]?.result) {
          const raw = injected[0].result;
          const fallbackError = detectHttpOrBrowserError(raw.url, raw.title, raw.bodySnippet);
          return {
            url: raw.url || tabUrl,
            title: raw.title || tabTitle || 'Untitled',
            elements: [],
            snapshotText: fallbackError.isError
              ? `[PAGE ERROR DETECTED]: ${fallbackError.type} - ${fallbackError.detail}\nPage text:\n${raw.bodySnippet.slice(0, 600)}`
              : (raw.bodySnippet
                  ? `[PAGE OBSERVATION (TEXT-ONLY FALLBACK)]:\n${raw.bodySnippet.slice(0, 1200)}`
                  : `[PAGE NOTICE]: Page loaded without visible text or interactive elements.`),
            bodySnippet: raw.bodySnippet,
            isErrorPage: fallbackError.isError,
            errorInfo: fallbackError,
          };
        }
      } catch {
        // executeScript also failed (e.g. edge-error:// or restricted page)
      }

      // Ultimate fallback: NEVER throw; return structured notice for the agent
      const ultimateError = detectHttpOrBrowserError(tabUrl, tabTitle, '');
      return {
        url: tabUrl,
        title: tabTitle || 'Unreachable or Restricted Page',
        elements: [],
        snapshotText: `[PAGE LOAD / BROWSER NOTICE]:
URL: ${tabUrl}
Title: ${tabTitle || 'Unknown'}
Status: The browser could not inspect page elements (${msgErr?.message || 'Content script unavailable'}).
${ultimateError.isError ? `Detected Error: ${ultimateError.type} (${ultimateError.detail}).` : 'The page may still be loading, restricted, or an internal error screen.'}
Directive for Agent: Do not halt execution. If you need content from this site, navigate to an alternate URL or search engine, or call "ask_user" if you are blocked.`,
        bodySnippet: tabTitle || 'Unreachable page',
        isErrorPage: true,
        errorInfo: ultimateError,
      };
    }

    // 4. Content script responded successfully!
    // Detect if page content or title indicates an HTTP error (404, 503, 529, 429, etc.)
    const pageError = detectHttpOrBrowserError(
      contentRes.url || tabUrl,
      contentRes.title || tabTitle,
      contentRes.bodySnippet || ''
    );

    return {
      ...contentRes,
      isErrorPage: pageError.isError,
      errorInfo: pageError,
    };
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

        const guidanceMatch =
          msg.content.match(/USER LIVE STEERING INSTRUCTION[\s\S]*?\n([^\n═║╚]+)\n[═║╚]/) ||
          msg.content.match(/\[USER REAL-TIME GUIDANCE \/ STEERING MESSAGE\]:\n"([^"]+)"/);
        const guidanceText = guidanceMatch ? `\n[Priority Steering Applied]: "${guidanceMatch[1].trim()}"` : '';

        msg.content = `[HISTORICAL STEP OBSERVATION]\nPage: ${title} (${url})${guidanceText}\n(DOM elements list omitted from history to conserve tokens; live elements provided in latest observation)`;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: any = null;
      const onWake = () => {
        if (timer) clearTimeout(timer);
        this.sleepResolve = undefined;
        resolve();
      };
      this.sleepResolve = onWake;
      timer = setTimeout(onWake, ms);
    });
  }

  public async run(followUpInstruction?: string): Promise<string> {
    this.aborted = false;
    this.paused = false;
    this.abortController = new AbortController();

    if (followUpInstruction) {
      this.consecutiveFailures = 0;
      this.lastFailedAction = undefined;
      this.lastSteeringInstruction = undefined;
    }

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

        // Budget check: If budget cap is set and exceeded, pause and request budget adjustment
        if (maxBudgetUSD > 0 && this.accumulatedCostUSD >= maxBudgetUSD) {
          this.callbacks.onLog?.(`Budget limit reached ($${maxBudgetUSD.toFixed(2)}). Awaiting new budget decision...`);

          // Trigger flashing toolbar icon badge to alert user
          notifyToolbarBadge('budget_limit');

          let decision: BudgetLimitDecision = { action: 'extend', newBudgetUSD: maxBudgetUSD + 0.25 };
          if (this.callbacks.onBudgetLimitReached) {
            decision = await this.callbacks.onBudgetLimitReached(this.accumulatedCostUSD, maxBudgetUSD);
          } else if (this.callbacks.onAskUser) {
            const userResponse = await this.callbacks.onAskUser(
              `Budget cap of $${maxBudgetUSD.toFixed(2)} reached (Current spend: $${this.accumulatedCostUSD.toFixed(4)}). Enter new budget or stop.`
            );
            if (userResponse.toLowerCase().includes('stop') || userResponse.toLowerCase().includes('conclude')) {
              decision = { action: 'conclude' };
            }
          }

          if (this.aborted || this.paused) {
            await this.clearBadges(tabId);
            return this.aborted ? 'Execution stopped by user.' : 'Execution paused.';
          }

          if (decision.action === 'conclude') {
            await this.clearBadges(tabId);
            const budgetStopMsg = `Task concluded at budget limit of $${maxBudgetUSD.toFixed(2)} (Total Spent: $${this.accumulatedCostUSD.toFixed(4)}).`;
            this.callbacks.onFinish?.(budgetStopMsg);
            return budgetStopMsg;
          }

          const targetBudget =
            decision.newBudgetUSD && decision.newBudgetUSD > this.accumulatedCostUSD
              ? decision.newBudgetUSD
              : Math.max(maxBudgetUSD + 0.25, Math.ceil(this.accumulatedCostUSD * 10) / 10 + 0.25);

          maxBudgetUSD = targetBudget;
          this.callbacks.onLog?.(`Budget extended to $${maxBudgetUSD.toFixed(2)}. Resuming task...`);
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
          this.callbacks.onLog?.(`Recovering page observation on tab #${tabId}: ${err.message}`);
          await this.sleep(1000);
          try {
            snapshot = await this.getPageSnapshot(tabId, showVisualLabels);
          } catch (recErr: any) {
            snapshot = {
              url: 'about:blank',
              title: 'Observation recovery',
              elements: [],
              snapshotText: `[PAGE OBSERVATION NOTICE]: Could not capture live elements: ${recErr?.message || 'Page unavailable'}.`,
              bodySnippet: 'Page observation unavailable',
              isErrorPage: true,
            };
          }
        }

        let elementsList = snapshot.snapshotText || 'No visible interactive elements detected.';
        // Clean line-based slicing if elements list exceeds 6000 characters
        if (elementsList.length > 6000) {
          const cutIdx = elementsList.lastIndexOf('\n', 6000);
          elementsList = (cutIdx > 0 ? elementsList.slice(0, cutIdx) : elementsList.slice(0, 6000)) + '\n... [Remaining elements truncated; scroll to view more]';
        }

        // Priority Steering Block (placed at the VERY TOP of the message)
        let prioritySteeringPrompt = '';
        if (this.steeringQueue.length > 0) {
          const guidanceList = this.steeringQueue.splice(0, this.steeringQueue.length);
          const guidance = guidanceList.join('\n');
          this.lastSteeringInstruction = guidance;
          this.activeSteeringForStep = guidance;

          prioritySteeringPrompt = `\
╔══════════════════════════════════════════════════════════════════════════════╗
║ 🚨 HIGHEST PRIORITY OVERRIDE: USER LIVE STEERING INSTRUCTION                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
${guidance}
╚══════════════════════════════════════════════════════════════════════════════╝
CRITICAL DIRECTIVE:
1. The user has intervened live with the instruction above.
2. This user steering OVERRIDES your previous plan, assumptions, and goal sub-tasks.
3. Your VERY NEXT ACTION must directly satisfy this instruction.
4. DO NOT ignore or postpone this instruction. Do not repeat what you were doing previously if it contradicts this guidance.

`;
          this.callbacks.onLog?.(`⚡ Applying priority steering: "${guidance.slice(0, 40)}..."`);
        } else if (this.lastSteeringInstruction) {
          prioritySteeringPrompt = `[ACTIVE USER STEERING DIRECTIVE]: "${this.lastSteeringInstruction}" (Remember to prioritize this guidance above all else).\n\n`;
        }

        // Action Failure & Anti-Repetition Alert Block with Skip vs. Ask Decision Matrix
        let failureAlertBlock = '';
        if (this.consecutiveFailures > 0 && this.lastFailedAction) {
          failureAlertBlock = `\
⚠️ ACTION FAILURE ALERT (${this.consecutiveFailures} consecutive failed attempt${this.consecutiveFailures > 1 ? 's' : ''}):
Your previous action "${this.lastFailedAction.toolName}" failed with:
"${this.lastFailedAction.resultStr.slice(0, 350)}"

STRICT REQUIREMENT - DECISION MATRIX:
1. NEVER repeat the exact same tool call with identical arguments. Repeating it will fail again.
2. Evaluate importance of this failed step:
   - If OPTIONAL or NON-ESSENTIAL (e.g., cookie popup, marketing overlay, optional form field, cosmetic element):
     -> SKIP IT! State in your thought that you are skipping this non-critical step, and proceed with the remaining task.
   - If CRITICAL to completing the goal (e.g., login, CAPTCHA, 2FA, primary submit button, missing required info):
     -> DO NOT loop or guess! Call "ask_user" immediately and clearly explain what assistance you need.
   - Otherwise, switch strategies: inspect the updated element IDs below, use "read_page_content", scroll, or use a specific selector.\n\n`;

          if (this.consecutiveFailures >= 3) {
            failureAlertBlock += `🚨 HIGH REPETITION FAILURE ALERT: You have encountered ${this.consecutiveFailures} consecutive failures. If this action cannot be skipped, you MUST call "ask_user" now.\n\n`;
          }
        }

        // HTTP / Browser Page Error Notice Block
        let pageErrorNotice = '';
        if (snapshot.isErrorPage && snapshot.errorInfo?.isError) {
          pageErrorNotice = `\
╔══════════════════════════════════════════════════════════════════════════════╗
║ ⚠️ HTTP / PAGE ERROR DETECTED ON CURRENT TAB: ${snapshot.errorInfo.type}
╠══════════════════════════════════════════════════════════════════════════════╣
║ Details: ${snapshot.errorInfo.detail}
║ Page Title: "${snapshot.title}"
║ URL: ${snapshot.url}
╚══════════════════════════════════════════════════════════════════════════════╝
CRITICAL DIRECTIVES FOR HANDLING THIS ERROR:
1. The webpage returned an error (${snapshot.errorInfo.type}). Interactive elements are likely unavailable.
2. DO NOT repeatedly click or type into missing elements on this error page.
3. If this is a temporary rate-limit or server overload (e.g. 503, 529, 429), use "wait" to pause or navigate to an alternate search/URL.
4. If this is a 404 (Not Found) or DNS failure, navigate to a search engine (like google.com or bing.com) to find a working link, or try an alternate URL.
5. If you cannot proceed without user intervention, call "ask_user" to explain the situation.\n\n`;
        } else if (snapshot.bodySnippet && (!snapshot.elements || snapshot.elements.length === 0)) {
          pageErrorNotice = `[PAGE TEXT SNIPPET]:\n"${snapshot.bodySnippet.slice(0, 500)}"\n\n`;
        }

        let observationContent = `${prioritySteeringPrompt}${failureAlertBlock}${pageErrorNotice}[CURRENT PAGE OBSERVATION]
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
            steeringApplied: this.activeSteeringForStep,
          };
          this.activeSteeringForStep = undefined;
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
          steeringApplied: this.activeSteeringForStep,
        };
        this.activeSteeringForStep = undefined;

        const executedResults: { id: string; name: string; resultStr: string; imageUrl?: string }[] = [];
        let shouldFinish = false;
        let finishSummary = '';

        for (let i = 0; i < toolCalls.length; i++) {
          const currentTool = toolCalls[i];
          const toolCallId = currentTool.id || `call_${this.stepCounter}_${i}`;
          const currentArgsKey = getToolCallKey(currentTool.name, currentTool.arguments);

          if (this.aborted || this.paused) {
            await this.clearBadges(tabId);
            return this.aborted ? 'Execution stopped by user.' : 'Execution paused.';
          }

          // Circuit Breaker: Prevent repeating the exact same failed action over and over
          const priorFailuresOfThisAction = this.actionHistory.filter(
            (h) => h.argsKey === currentArgsKey && h.failed
          );

          if (priorFailuresOfThisAction.length >= 2) {
            const circuitBreakerMsg = `[CIRCUIT BREAKER: REPEATED FAILURE BLOCKED]: You have already attempted "${currentTool.name}" with identical parameters ${priorFailuresOfThisAction.length} times, and it failed every time. Repeating this exact action is blocked to avoid an infinite loop. You MUST change your strategy (inspect updated badges, use read_page_content, scroll, or call ask_user).`;
            this.callbacks.onLog?.(`🛑 Blocked repeated failed action: ${currentTool.name}`);
            executedResults.push({
              id: toolCallId,
              name: currentTool.name,
              resultStr: circuitBreakerMsg,
            });
            this.consecutiveFailures++;
            this.lastFailedAction = {
              toolName: currentTool.name,
              argsKey: currentArgsKey,
              resultStr: circuitBreakerMsg,
            };
            this.actionHistory.push({
              toolName: currentTool.name,
              argsKey: currentArgsKey,
              stepNumber: this.stepCounter,
              resultStr: circuitBreakerMsg,
              failed: true,
            });
            continue;
          }

          let resultStr = '';
          let resultImageUrl: string | undefined = undefined;

          if (currentTool.name === 'finish') {
            const explicitSummary = currentTool.arguments.summary?.trim();
            finishSummary = explicitSummary || 'Task completed successfully.';
            shouldFinish = true;
            resultStr = 'Task completed.';
            executedResults.push({
              id: toolCallId,
              name: 'finish',
              resultStr,
            });
            break;
          } else if (currentTool.name === 'take_screenshot') {
            this.callbacks.onLog?.('Capturing tab screenshot...');
            const shotRes = await performTabScreenshot(tabId);

            if (shotRes?.success && shotRes?.dataUrl) {
              stepRecord.screenshotUrl = shotRes.dataUrl;
              this.pendingScreenshotUrl = shotRes.dataUrl;
              resultImageUrl = shotRes.dataUrl;
              resultStr = 'Screenshot captured successfully. Visual screenshot image is provided directly to you in the observation.';
            } else {
              resultStr = `Screenshot capture failed: ${shotRes?.error || 'Unknown error'}`;
            }

            executedResults.push({
              id: toolCallId,
              name: 'take_screenshot',
              resultStr,
              imageUrl: resultImageUrl,
            });
          } else if (currentTool.name === 'ask_user') {
            const question = currentTool.arguments.question || 'Clarification needed from user.';
            stepRecord.resultMessage = `Waiting for user: "${question}"`;
            this.callbacks.onStepComplete?.(stepRecord);
            this.callbacks.onLog?.('Awaiting your input...');

            // Trigger blinking toolbar icon badge for user attention!
            notifyToolbarBadge('ask_user', { question });

            let userReply = 'Confirmed. Please proceed.';
            if (this.callbacks.onAskUser) {
              userReply = await this.callbacks.onAskUser(question);
            }

            if (this.aborted || this.paused) {
              await this.clearBadges(tabId);
              return this.aborted ? 'Execution stopped by user.' : 'Execution paused.';
            }

            resultStr = `User responded: "${userReply}". Please proceed with the next step.`;
            executedResults.push({
              id: toolCallId,
              name: 'ask_user',
              resultStr,
            });
          } else if (currentTool.name === 'wait') {
            const secs = Math.min(10, Math.max(1, parseInt(currentTool.arguments.seconds || '2', 10)));
            this.callbacks.onLog?.(`Waiting ${secs}s...`);
            await this.sleep(secs * 1000);
            resultStr = `Waited for ${secs} seconds.`;
            executedResults.push({
              id: toolCallId,
              name: 'wait',
              resultStr,
            });
          } else if (currentTool.name === 'navigate') {
            const url = currentTool.arguments.url;
            this.callbacks.onLog?.(`Navigating tab #${tabId} to ${url}...`);
            const navRes = await performTabNavigation(tabId, url);
            // Brief grace period for page rendering to settle
            await this.sleep(1200);

            if (navRes && !navRes.success) {
              resultStr = navRes.error || `Failed to navigate to ${url}: Site does not exist or could not be loaded.`;
            } else {
              resultStr = `Navigated to ${url}.`;
            }
            executedResults.push({
              id: toolCallId,
              name: 'navigate',
              resultStr,
            });
          } else {
            if (currentTool.name === 'read_page_content') {
              this.callbacks.onLog?.('Reading page DOM text...');
            } else if (currentTool.name === 'get_element_text') {
              this.callbacks.onLog?.(`Reading element #${currentTool.arguments.elementId || currentTool.arguments.selector}...`);
            }
            const domRes = await this.executeDOMAction(tabId, currentTool.name, currentTool.arguments);
            resultStr = domRes.message || JSON.stringify(domRes);
            executedResults.push({
              id: toolCallId,
              name: currentTool.name,
              resultStr,
            });
          }

          const actionFailed = isToolResultFailed(resultStr);
          this.actionHistory.push({
            toolName: currentTool.name,
            argsKey: currentArgsKey,
            stepNumber: this.stepCounter,
            resultStr,
            failed: actionFailed,
          });

          if (actionFailed) {
            this.consecutiveFailures++;
            this.lastFailedAction = {
              toolName: currentTool.name,
              argsKey: currentArgsKey,
              resultStr,
            };
          } else {
            this.consecutiveFailures = 0;
            this.lastFailedAction = undefined;
          }
        }

        const combinedResultStr = executedResults.map((r) => `[${r.name}] ${r.resultStr}`).join('\n');
        stepRecord.status = executedResults.some((r) => isToolResultFailed(r.resultStr)) ? 'failed' : 'success';
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
            toolName: r.name,
            content: r.resultStr,
            imageUrl: r.imageUrl,
          });
        }

        if (shouldFinish) {
          await this.clearBadges(tabId);
          this.completed = true;
          notifyToolbarBadge('finish', { summary: finishSummary });
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
