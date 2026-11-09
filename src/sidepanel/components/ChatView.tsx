import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Pause,
  Play,
  Sparkles,
  Copy,
  Check,
  Terminal,
  Compass,
  HelpCircle,
  ArrowRight,
  Navigation,
  Eye,
  Plus,
  Download,
  FileText,
  RotateCcw,
  User,
  Bot,
} from 'lucide-react';
import { TargetTabInfo } from '../../core/agent/loop';
import { StepTimeline } from './StepTimeline';
import { MarkdownViewer } from './MarkdownViewer';
import { ChatTurn } from '../App';

interface ChatViewProps {
  isRunning: boolean;
  isPaused: boolean;
  hasActiveSession: boolean;
  onStartTask: (goal: string) => void;
  onPauseTask: () => void;
  onResumeTask: (followUp: string) => void;
  onSendSteering: (guidance: string) => void;
  onNewChat: () => void;
  turns: ChatTurn[];
  currentStep: number;
  maxBudgetUSD: number;
  liveCostUSD: number;
  liveTokens: number;
  liveCachedTokens?: number;
  liveStatus: string;
  activeProvider: string;
  activeModel: string;
  pendingQuestion?: string | null;
  onAnswerQuestion?: (answer: string) => void;
  targetTab?: TargetTabInfo | null;
  onFocusTab?: () => void;
  onCreateNewTab?: () => void;
  onGetFullMessages?: () => any[];
}

const QUICK_PROMPTS = [
  'Extract all product titles and prices on this page',
  'Summarize the core takeaways of this article into bullet points',
  'Find the search bar, search for "Quantum Computing", and report the first 3 links',
  'Fill out the form fields on this page with realistic sample data',
];

export const ChatView: React.FC<ChatViewProps> = ({
  isRunning,
  isPaused,
  hasActiveSession,
  onStartTask,
  onPauseTask,
  onResumeTask,
  onSendSteering,
  onNewChat,
  turns,
  currentStep,
  maxBudgetUSD,
  liveCostUSD,
  liveTokens,
  liveCachedTokens = 0,
  liveStatus,
  activeProvider,
  activeModel,
  pendingQuestion,
  onAnswerQuestion,
  targetTab,
  onFocusTab,
  onCreateNewTab,
  onGetFullMessages,
}) => {
  const [inputText, setInputText] = useState('');
  const [answerInput, setAnswerInput] = useState('');
  const [steeringToast, setSteeringToast] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll only when new content or turns arrive (never on 1s thinking timer)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, liveStatus, pendingQuestion, isPaused, isRunning]);

  // Real-time Thinking seconds timer
  useEffect(() => {
    let timer: any = null;
    if (isRunning && !isPaused) {
      setThinkingSeconds(0);
      timer = setInterval(() => {
        setThinkingSeconds((s) => s + 1);
      }, 1000);
    } else {
      setThinkingSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRunning, isPaused, currentStep]);

  // Auto-focus question input if ask_user is triggered
  useEffect(() => {
    if (pendingQuestion && answerInputRef.current) {
      answerInputRef.current.focus();
    }
  }, [pendingQuestion]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    if (isRunning && !isPaused) {
      // Send mid-flight steering guidance
      onSendSteering(trimmed);
      setInputText('');
      setSteeringToast(true);
      setTimeout(() => setSteeringToast(false), 2500);
      return;
    }

    if (hasActiveSession) {
      // Continue in the SAME chat! Keeps all previous turns & context intact!
      onResumeTask(trimmed);
      setInputText('');
      return;
    }

    // Start brand new task
    onStartTask(trimmed);
    setInputText('');
  };

  const handleSendAnswer = (text: string) => {
    if (!text.trim() || !onAnswerQuestion) return;
    onAnswerQuestion(text.trim());
    setAnswerInput('');
  };

  const handleCopyResult = (content: string, turnId: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(turnId);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleDownloadMarkdown = (content: string, turnIdx: number) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `browseragent-summary-turn${turnIdx + 1}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJSON = (turn: ChatTurn, turnIdx: number) => {
    const data = {
      timestamp: new Date(turn.timestamp).toISOString(),
      provider: activeProvider,
      model: activeModel,
      turnNumber: turnIdx + 1,
      userPrompt: turn.userPrompt,
      summary: turn.resultSummary,
      steps: turn.steps.map((s) => ({
        step: s.stepNumber,
        thought: s.thought,
        toolCalls: s.toolCalls || (s.toolCall ? [s.toolCall] : []),
        result: s.resultMessage,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `browseragent-turn${turnIdx + 1}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportFullSessionJSON = () => {
    const rawMessages = onGetFullMessages ? onGetFullMessages() : [];
    const totalStepsCount = turns.reduce((acc, t) => acc + t.steps.length, 0);

    const fullSessionData = {
      version: '1.1.8',
      exportTimestamp: new Date().toISOString(),
      session: {
        provider: activeProvider,
        model: activeModel,
        status: isRunning ? 'running' : isPaused ? 'paused' : 'completed_or_idle',
        targetTab: targetTab
          ? {
              id: targetTab.id,
              title: targetTab.title,
              url: targetTab.url,
            }
          : null,
        telemetry: {
          totalCostUSD: liveCostUSD,
          totalTokens: liveTokens,
          cachedTokens: liveCachedTokens,
          maxBudgetUSD: maxBudgetUSD,
          turnCount: turns.length,
          stepCount: totalStepsCount,
        },
      },
      turns: turns.map((turn, tIdx) => ({
        turnNumber: tIdx + 1,
        id: turn.id,
        timestamp: new Date(turn.timestamp).toISOString(),
        status: turn.status,
        userPrompt: turn.userPrompt,
        resultSummary: turn.resultSummary,
        steps: turn.steps.map((s) => ({
          stepNumber: s.stepNumber,
          status: s.status,
          timestamp: s.timestamp ? new Date(s.timestamp).toISOString() : undefined,
          thought: s.thought,
          toolCalls: s.toolCalls || (s.toolCall ? [s.toolCall] : []),
          resultMessage: s.resultMessage,
          costUSD: s.costUSD,
          cachedTokens: s.cachedTokens,
          hasScreenshot: Boolean(s.screenshotUrl),
        })),
      })),
      rawMessages,
    };

    const blob = new Blob([JSON.stringify(fullSessionData, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `browseragent-full-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportFullSessionMarkdown = () => {
    const rawMessages = onGetFullMessages ? onGetFullMessages() : [];
    const totalStepsCount = turns.reduce((acc, t) => acc + t.steps.length, 0);
    const exportTime = new Date().toISOString();

    let md = `# 🌐 BrowserAgent Session Transcript\n\n`;
    md += `| Metadata | Value |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **Export Date** | \`${exportTime}\` |\n`;
    md += `| **Provider** | **${activeProvider}** |\n`;
    md += `| **Model** | \`${activeModel}\` |\n`;
    md += `| **Session Status** | \`${isRunning ? 'Running' : isPaused ? 'Paused' : 'Completed'}\` |\n`;
    if (targetTab) {
      md += `| **Target Tab** | \`#${targetTab.id}\` — [${targetTab.title || 'Tab'}](${targetTab.url || ''}) |\n`;
    }
    md += `| **Total Turns** | \`${turns.length}\` |\n`;
    md += `| **Total Steps** | \`${totalStepsCount}\` |\n`;
    md += `| **Total Cost** | \`$${liveCostUSD.toFixed(5)} USD\` |\n`;
    md += `| **Total Tokens** | \`${liveTokens.toLocaleString()}\` |\n`;
    md += `| **Cached Tokens** | \`${liveCachedTokens.toLocaleString()}\` |\n\n`;
    md += `---\n\n`;

    turns.forEach((turn, tIdx) => {
      md += `## Turn ${tIdx + 1}: ${turn.userPrompt}\n\n`;
      md += `- **Started:** \`${new Date(turn.timestamp).toISOString()}\`\n`;
      md += `- **Status:** \`${turn.status}\`\n\n`;

      if (turn.steps.length > 0) {
        md += `### Execution Steps (${turn.steps.length})\n\n`;
        turn.steps.forEach((s) => {
          md += `#### Step ${s.stepNumber} [${s.status.toUpperCase()}]\n\n`;
          if (s.thought) {
            md += `**Thought:**\n> ${s.thought.replace(/\n/g, '\n> ')}\n\n`;
          }

          const calls = s.toolCalls || (s.toolCall ? [s.toolCall] : []);
          if (calls.length > 0) {
            md += `**Tool Action:**\n\`\`\`json\n${JSON.stringify(calls, null, 2)}\n\`\`\`\n\n`;
          }

          if (s.resultMessage) {
            md += `**DOM Result / Observation:**\n\`\`\`\n${s.resultMessage}\n\`\`\`\n\n`;
          }

          if (s.cachedTokens) {
            md += `*Prompt Cache Hit: ${s.cachedTokens.toLocaleString()} tokens saved*\n\n`;
          }
        });
      }

      if (turn.resultSummary) {
        md += `### Turn ${tIdx + 1} Result Summary\n\n${turn.resultSummary}\n\n`;
      }

      md += `---\n\n`;
    });

    if (rawMessages.length > 0) {
      md += `## 📜 Raw LLM Message History (${rawMessages.length} messages)\n\n`;
      md += `<details>\n<summary>Click to expand complete messages payload</summary>\n\n`;
      md += `\`\`\`json\n${JSON.stringify(rawMessages, null, 2)}\n\`\`\`\n\n`;
      md += `</details>\n`;
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `browseragent-full-session-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const budgetRatio = maxBudgetUSD > 0 ? liveCostUSD / maxBudgetUSD : 0;
  const budgetPercent = Math.min(100, Math.round(budgetRatio * 100));

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-85px)] overflow-hidden">
      {/* Target Tab Binding & Session Control Bar */}
      <div className="mx-3.5 mt-2 mb-1 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 flex items-center justify-between text-[11px] shadow-sm">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
          <span className="font-mono text-sky-400 shrink-0 font-medium">
            {targetTab ? `Tab #${targetTab.id}` : 'Detecting...'}
          </span>
          <span className="text-slate-300 truncate" title={targetTab?.title || targetTab?.url}>
            {targetTab?.title || targetTab?.url || 'No active tab selected'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {targetTab && onFocusTab && (
            <button
              type="button"
              onClick={onFocusTab}
              title="Bring assigned target tab to front"
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 text-[10px] flex items-center gap-1 transition-colors border border-slate-700/60 font-medium"
            >
              <Eye className="h-3 w-3" />
              <span>Focus Tab</span>
            </button>
          )}

          {turns.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportFullSessionMarkdown}
                title="Export entire conversation & all metadata as Markdown (.MD)"
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors border border-slate-700/60 font-medium"
              >
                <Download className="h-3 w-3 text-sky-400" />
                <span>Export .MD</span>
              </button>

              <button
                type="button"
                onClick={handleExportFullSessionJSON}
                title="Export entire conversation & all metadata as JSON (.JSON)"
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors border border-slate-700/60 font-medium"
              >
                <FileText className="h-3 w-3 text-emerald-400" />
                <span>Export .JSON</span>
              </button>
            </>
          )}

          {hasActiveSession && onNewChat && (
            <button
              type="button"
              onClick={onNewChat}
              title="Start a fresh new chat session"
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] flex items-center gap-1 transition-colors border border-slate-700/60 font-medium"
            >
              <RotateCcw className="h-3 w-3 text-sky-400" />
              <span>New Chat</span>
            </button>
          )}

          {!isRunning && onCreateNewTab && (
            <button
              type="button"
              onClick={onCreateNewTab}
              title="Open a brand new tab for the agent"
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 transition-colors border border-slate-700/60"
            >
              <Plus className="h-3 w-3" />
              <span>New Tab</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Chronological Chat Stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-5 pt-1">
        {/* Welcome State when no conversation has started */}
        {turns.length === 0 && (
          <div className="space-y-4 pt-2">
            <div className="text-center py-6 px-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl">
              <div className="h-10 w-10 mx-auto rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-3">
                <Compass className="h-5 w-5 text-sky-400" />
              </div>
              <h2 className="text-sm font-semibold text-white">BrowserAgent Ready</h2>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                Describe any task. BrowserAgent operates directly on the locked tab so you can multi-task on other tabs without disruption.
              </p>
              <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/70 border border-slate-700/50 text-[10px] text-slate-300">
                <span>Model:</span>
                <span className="text-sky-300 font-mono">{activeModel.split('/').pop()}</span>
                <span className="text-slate-500">•</span>
                <span>BYOK</span>
              </div>
            </div>

            {/* Quick Starters */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 px-1">
                <Sparkles className="h-3 w-3 text-sky-400" />
                <span>Quick Starters</span>
              </span>
              <div className="space-y-1.5">
                {QUICK_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setInputText(prompt);
                    }}
                    className="w-full text-left text-xs bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 p-2.5 rounded-lg text-slate-300 hover:text-white transition-all leading-snug"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chronological Chat Stream: Goal -> Steps -> Assistant Reply -> Follow-up -> Next Reply */}
        {turns.map((turn, tIdx) => {
          const isLatestTurn = tIdx === turns.length - 1;

          return (
            <div key={turn.id} className="space-y-3.5 pb-2 border-b border-slate-800/40 last:border-b-0">
              {/* 1. User Message Bubble */}
              <div className="flex justify-end">
                <div className="bg-sky-600/20 border border-sky-500/35 rounded-2xl rounded-tr-sm px-3.5 py-2 text-xs text-white max-w-[85%] leading-relaxed shadow-sm">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-sky-400 mb-0.5">
                    <User className="h-3 w-3" />
                    <span>{tIdx === 0 ? 'Goal / Request' : 'Follow-up'}</span>
                  </div>
                  <p className="font-sans font-medium whitespace-pre-wrap">{turn.userPrompt}</p>
                </div>
              </div>

              {/* 2. Action Steps Timeline for this specific turn */}
              {turn.steps.length > 0 && (
                <StepTimeline
                  steps={turn.steps}
                  isRunning={isRunning && isLatestTurn}
                  isPaused={isPaused && isLatestTurn}
                />
              )}

              {/* 3. Real-Time Pulsing Thinking Indicator while waiting for LLM API response */}
              {isRunning && isLatestTurn && !isPaused && (
                <div className="flex items-start gap-2.5 animate-fade-in pl-1">
                  <div className="h-6 w-6 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center shrink-0 mt-0.5 text-sky-400">
                    <Bot className="h-3.5 w-3.5 animate-pulse" />
                  </div>
                  <div className="bg-slate-900/90 border border-slate-800 rounded-2xl rounded-tl-sm px-3.5 py-2 text-xs text-slate-200 shadow-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sky-300 text-[11px]">
                        Thinking with {activeModel.split('/').pop()}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        ({thinkingSeconds}s)
                      </span>
                      <div className="flex items-center gap-1 ml-0.5">
                        <span className="h-1 w-1 rounded-full bg-sky-400 animate-bounce [animation-delay:0ms]" />
                        <span className="h-1 w-1 rounded-full bg-sky-400 animate-bounce [animation-delay:150ms]" />
                        <span className="h-1 w-1 rounded-full bg-sky-400 animate-bounce [animation-delay:300ms]" />
                      </div>
                    </div>
                    {liveStatus && (
                      <p className="text-[10px] text-slate-400 font-mono truncate max-w-xs">
                        {liveStatus}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 4. Live Running Status Banner with Visual Budget Progress Bar */}
              {isRunning && isLatestTurn && (
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-slate-400">Step {currentStep}</span>
                      {liveTokens > 0 && (
                        <span className="text-slate-500 font-mono text-[10px]">
                          • {liveTokens.toLocaleString()} tokens
                        </span>
                      )}
                      {liveCachedTokens > 0 && (
                        <span
                          className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[9px] font-mono flex items-center gap-0.5"
                          title="Tokens reused from server cache at 90% discount"
                        >
                          ⚡ {liveCachedTokens.toLocaleString()} cached
                        </span>
                      )}
                    </div>
                    <span className="text-emerald-400 font-mono font-medium">
                      ${liveCostUSD.toFixed(3)}
                      {maxBudgetUSD > 0 && (
                        <span className="text-slate-500"> / ${maxBudgetUSD.toFixed(2)}</span>
                      )}
                    </span>
                  </div>

                  {maxBudgetUSD > 0 && (
                    <div className="w-full bg-slate-950 rounded-full h-1 overflow-hidden border border-slate-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          budgetPercent >= 90
                            ? 'bg-rose-500'
                            : budgetPercent >= 70
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                        }`}
                        style={{ width: `${budgetPercent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 5. Inline Assistant Reply (ChatGPT / Claude Style) */}
              {turn.resultSummary && (
                <div className="flex items-start gap-2.5 animate-fade-in pl-1">
                  <div className="h-6 w-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5 text-emerald-400">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0 bg-slate-900/90 border border-slate-800/90 rounded-2xl rounded-tl-sm p-3.5 space-y-2.5 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 text-[11px]">
                      <div className="flex items-center gap-1.5 font-medium text-slate-300">
                        <span className="text-sky-400">BrowserAgent</span>
                        <span className="text-slate-600">•</span>
                        <span className="text-slate-400 font-mono">{activeModel.split('/').pop()}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleDownloadMarkdown(turn.resultSummary!, tIdx)}
                          title="Download report as Markdown file (.md)"
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
                        >
                          <FileText className="h-2.5 w-2.5 text-sky-400" />
                          <span>.MD</span>
                        </button>
                        <button
                          onClick={() => handleDownloadJSON(turn, tIdx)}
                          title="Download structured data as JSON (.json)"
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
                        >
                          <Download className="h-2.5 w-2.5 text-emerald-400" />
                          <span>.JSON</span>
                        </button>
                        <button
                          onClick={() => handleCopyResult(turn.resultSummary!, turn.id)}
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
                        >
                          {copiedId === turn.id ? (
                            <Check className="h-2.5 w-2.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-2.5 w-2.5" />
                          )}
                          <span>{copiedId === turn.id ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                    <div className="text-xs">
                      <MarkdownViewer content={turn.resultSummary} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Steering Confirmation Toast */}
      {steeringToast && (
        <div className="mx-3.5 mb-1 py-1 px-2.5 bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[11px] rounded-lg flex items-center gap-1.5 animate-fade-in">
          <Navigation className="h-3 w-3" />
          <span>Steering instruction queued for next step!</span>
        </div>
      )}

      {/* PINNED Interactive ask_user Question Card (Docked directly above input bar so user cannot miss it) */}
      {pendingQuestion && (
        <div className="mx-3.5 mb-2 bg-gradient-to-r from-amber-950/80 to-slate-900 border-2 border-amber-500 rounded-xl p-3 space-y-2.5 shadow-xl shadow-amber-500/20 animate-fade-in z-20">
          <div className="flex items-start gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5">
              <HelpCircle className="h-4 w-4 text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-amber-300">Action Needed / Clarification</span>
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
              </div>
              <p className="text-xs text-slate-100 mt-1 leading-relaxed font-semibold">
                {pendingQuestion}
              </p>
            </div>
          </div>

          <div className="space-y-2 pt-1 border-t border-slate-800">
            <div className="flex gap-2">
              <input
                ref={answerInputRef}
                type="text"
                value={answerInput}
                onChange={(e) => setAnswerInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSendAnswer(answerInput);
                  }
                }}
                placeholder="Type your reply here and press Enter..."
                className="flex-1 bg-slate-950 border border-amber-500/60 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
              />
              <button
                type="button"
                onClick={() => handleSendAnswer(answerInput)}
                disabled={!answerInput.trim()}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-semibold rounded-lg text-xs flex items-center gap-1 transition-colors shrink-0 shadow-md shadow-amber-500/20"
              >
                <span>Reply</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] pt-0.5">
              <span className="text-slate-400">If you completed a manual action (e.g. CAPTCHA / 2FA):</span>
              <button
                type="button"
                onClick={() => handleSendAnswer('I have completed the manual action on the page. Please continue.')}
                className="px-2.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded border border-slate-700 text-[10px] font-medium transition-colors"
              >
                Done, Continue →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input Box & Action Bar */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-900/90 backdrop-blur-md">
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="relative">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                isRunning && !isPaused
                  ? "Steer agent mid-flight (Ctrl+Enter to send)..."
                  : isPaused
                  ? "Task paused. Enter follow-up instruction (Ctrl+Enter)..."
                  : hasActiveSession
                  ? "Ask follow-up in this same chat (Ctrl+Enter)..."
                  : "Give a task on assigned tab (Ctrl+Enter to start)..."
              }
              rows={2}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 resize-none font-sans"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {isRunning ? (
                <button
                  type="button"
                  onClick={onPauseTask}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                    isPaused
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                      : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Pause className="h-3 w-3" />
                  <span>{isPaused ? 'Paused' : 'Pause'}</span>
                </button>
              ) : null}

              {isPaused && (
                <button
                  type="button"
                  onClick={() => handleSubmit()}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20"
                >
                  <Play className="h-3 w-3" />
                  <span>Resume Task</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={!inputText.trim()}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
                  isRunning && !isPaused
                    ? 'bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white'
                    : isPaused
                    ? 'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white'
                    : hasActiveSession
                    ? 'bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-black shadow-sky-500/20'
                    : 'bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-black shadow-sky-500/20'
                }`}
              >
                {isRunning && !isPaused ? (
                  <>
                    <Navigation className="h-3 w-3" />
                    <span>Steer</span>
                  </>
                ) : isPaused ? (
                  <>
                    <Play className="h-3 w-3" />
                    <span>Resume with Note</span>
                  </>
                ) : hasActiveSession ? (
                  <>
                    <Send className="h-3 w-3" />
                    <span>Send Follow-up</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3 w-3" />
                    <span>Start Task</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
