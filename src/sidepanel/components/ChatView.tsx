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
} from 'lucide-react';
import { StepRecord, TargetTabInfo } from '../../core/agent/loop';
import { StepTimeline } from './StepTimeline';
import { MarkdownViewer } from './MarkdownViewer';
import { UserPromptEntry } from '../App';

interface ChatViewProps {
  isRunning: boolean;
  isPaused: boolean;
  hasActiveSession: boolean;
  onStartTask: (goal: string) => void;
  onPauseTask: () => void;
  onResumeTask: (followUp: string) => void;
  onSendSteering: (guidance: string) => void;
  onNewChat: () => void;
  userPrompts?: UserPromptEntry[];
  currentStep: number;
  maxBudgetUSD: number;
  liveCostUSD: number;
  liveTokens: number;
  liveStatus: string;
  steps: StepRecord[];
  finalResult: string | null;
  activeProvider: string;
  activeModel: string;
  pendingQuestion?: string | null;
  onAnswerQuestion?: (answer: string) => void;
  targetTab?: TargetTabInfo | null;
  onFocusTab?: () => void;
  onCreateNewTab?: () => void;
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
  userPrompts = [],
  currentStep,
  maxBudgetUSD,
  liveCostUSD,
  liveTokens,
  liveStatus,
  steps,
  finalResult,
  activeProvider,
  activeModel,
  pendingQuestion,
  onAnswerQuestion,
  targetTab,
  onFocusTab,
  onCreateNewTab,
}) => {
  const [inputText, setInputText] = useState('');
  const [answerInput, setAnswerInput] = useState('');
  const [steeringToast, setSteeringToast] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps, liveStatus, finalResult, pendingQuestion, isPaused, userPrompts]);

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
      // Continue in the SAME chat! Does not wipe previous steps or context!
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

  const handleCopyResult = () => {
    if (finalResult) {
      navigator.clipboard.writeText(finalResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!finalResult) return;
    const blob = new Blob([finalResult], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `browseragent-summary-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJSON = () => {
    if (!finalResult) return;
    const data = {
      timestamp: new Date().toISOString(),
      provider: activeProvider,
      model: activeModel,
      totalCostUSD: liveCostUSD,
      totalTokens: liveTokens,
      stepsCount: steps.length,
      userPrompts: userPrompts.map((p) => p.text),
      summary: finalResult,
      steps: steps.map((s) => ({
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
    a.download = `browseragent-report-${Date.now()}.json`;
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

      {/* Scrollable Timeline & Results View */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-4 pt-1">
        {/* Welcome State when no tasks or steps */}
        {steps.length === 0 && !finalResult && !pendingQuestion && userPrompts.length === 0 && (
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

        {/* User Conversation Prompts */}
        {userPrompts.length > 0 && (
          <div className="space-y-2.5">
            {userPrompts.map((p, idx) => (
              <div key={p.id} className="flex justify-end">
                <div className="bg-sky-600/15 border border-sky-500/30 rounded-2xl rounded-tr-sm px-3.5 py-2 text-xs text-white max-w-[85%] leading-relaxed shadow-sm">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-sky-400 mb-0.5">
                    <User className="h-3 w-3" />
                    <span>{idx === 0 ? 'Initial Goal' : 'Follow-up Instruction'}</span>
                  </div>
                  <p className="font-sans font-medium whitespace-pre-wrap">{p.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Live Running Status Banner */}
        {isRunning && (
          <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
                <span className="font-semibold text-sky-300">
                  {pendingQuestion
                    ? 'Paused: Waiting for your input'
                    : isPaused
                    ? 'Paused: Awaiting follow-up'
                    : 'Executing Task on Assigned Tab...'}
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="text-slate-400">Step {currentStep}</span>
                <span className="text-slate-600">•</span>
                <span className="text-emerald-400 font-bold">
                  ${liveCostUSD.toFixed(3)}
                  {maxBudgetUSD > 0 ? (
                    <span className="text-slate-500 font-normal"> / ${maxBudgetUSD.toFixed(2)}</span>
                  ) : (
                    <span className="text-slate-500 font-normal"> (No limit)</span>
                  )}
                </span>
              </div>
            </div>

            {/* Visual Budget Progress Bar */}
            {maxBudgetUSD > 0 && (
              <div className="space-y-1">
                <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
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
              </div>
            )}

            {liveStatus && (
              <div className="flex items-center gap-2 text-xs text-slate-300 font-mono bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800">
                <Terminal className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{liveStatus}</span>
              </div>
            )}
          </div>
        )}

        {/* Interactive ask_user Question Card */}
        {pendingQuestion && (
          <div className="bg-gradient-to-br from-amber-950/40 to-slate-900 border border-amber-500/50 rounded-xl p-3.5 space-y-3 shadow-lg shadow-amber-500/10 animate-fade-in">
            <div className="flex items-start gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
                <HelpCircle className="h-4 w-4 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-amber-300">Agent Question / Action Needed</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                </div>
                <p className="text-xs text-slate-200 mt-1 leading-relaxed font-medium">
                  {pendingQuestion}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-800/80">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={answerInput}
                  onChange={(e) => setAnswerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSendAnswer(answerInput);
                    }
                  }}
                  placeholder="Type your response or clarification here..."
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => handleSendAnswer(answerInput)}
                  disabled={!answerInput.trim()}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-semibold rounded-lg text-xs flex items-center gap-1 transition-colors"
                >
                  <span>Reply</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] pt-1">
                <span className="text-slate-400">If you completed a manual action (e.g. CAPTCHA / Login):</span>
                <button
                  type="button"
                  onClick={() => handleSendAnswer('I have completed the manual action on the page. Please continue.')}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded border border-slate-700 text-[10px] font-medium transition-colors"
                >
                  Done, Continue →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action Steps Timeline (with isRunning and isPaused props to prevent spinning loaders on completed steps) */}
        <StepTimeline steps={steps} isRunning={isRunning} isPaused={isPaused} />

        {/* Final Result Card with Data Export */}
        {finalResult && (
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 rounded-xl p-3.5 space-y-2.5 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <Check className="h-4 w-4" />
                <span>Task Summary</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleDownloadMarkdown}
                  title="Download report as Markdown file (.md)"
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
                >
                  <FileText className="h-3 w-3 text-sky-400" />
                  <span>.MD</span>
                </button>
                <button
                  onClick={handleDownloadJSON}
                  title="Download structured data and steps as JSON (.json)"
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
                >
                  <Download className="h-3 w-3 text-emerald-400" />
                  <span>.JSON</span>
                </button>
                <button
                  onClick={handleCopyResult}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
              <MarkdownViewer content={finalResult} />
            </div>
          </div>
        )}
      </div>

      {/* Steering Confirmation Toast */}
      {steeringToast && (
        <div className="mx-3.5 mb-1 py-1 px-2.5 bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[11px] rounded-lg flex items-center gap-1.5 animate-fade-in">
          <Navigation className="h-3 w-3" />
          <span>Steering instruction queued for next step!</span>
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
                  ? "Ask a follow-up or next instruction in this same chat (Ctrl+Enter)..."
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
