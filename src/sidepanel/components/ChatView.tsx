import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Play, Sparkles, Copy, Check, Terminal, Compass, Layers } from 'lucide-react';
import { StepRecord } from '../../core/agent/loop';
import { StepTimeline } from './StepTimeline';

interface ChatViewProps {
  isRunning: boolean;
  onStartTask: (goal: string) => void;
  onStopTask: () => void;
  currentStep: number;
  maxSteps: number;
  liveStatus: string;
  steps: StepRecord[];
  finalResult: string | null;
  activeProvider: string;
  activeModel: string;
}

const QUICK_PROMPTS = [
  'Extract all product titles and prices on this page',
  'Summarize the core takeaways of this article into bullet points',
  'Find the search bar, search for "Quantum Computing", and report the first 3 links',
  'Fill out the form fields on this page with realistic sample data',
];

export const ChatView: React.FC<ChatViewProps> = ({
  isRunning,
  onStartTask,
  onStopTask,
  currentStep,
  maxSteps,
  liveStatus,
  steps,
  finalResult,
  activeProvider,
  activeModel,
}) => {
  const [goal, setGoal] = useState('');
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps, liveStatus, finalResult]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || isRunning) return;
    onStartTask(goal.trim());
  };

  const handleCopyResult = () => {
    if (finalResult) {
      navigator.clipboard.writeText(finalResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-85px)] overflow-hidden">
      {/* Scrollable Timeline & Results View */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {steps.length === 0 && !finalResult && (
          <div className="space-y-4 pt-2">
            <div className="text-center py-6 px-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl">
              <div className="h-10 w-10 mx-auto rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-3">
                <Compass className="h-5 w-5 text-sky-400" />
              </div>
              <h2 className="text-sm font-semibold text-white">BrowserAgent Ready</h2>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                Describe any task on the active tab. BrowserAgent will inspect elements, reason, click, type, and complete it autonomously.
              </p>
              <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/70 border border-slate-700/50 text-[10px] text-slate-300">
                <span>Model:</span>
                <span className="text-sky-300 font-mono">{activeModel.split('/').pop()}</span>
              </div>
            </div>

            {/* Quick Inspiration Prompts */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-sky-400" />
                <span>Quick Prompts:</span>
              </span>
              <div className="space-y-1.5">
                {QUICK_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setGoal(prompt)}
                    className="w-full text-left text-xs bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 p-2.5 rounded-lg text-slate-300 hover:text-white transition-all leading-snug"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Live Running Status Banner */}
        {isRunning && (
          <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
                <span className="font-semibold text-sky-300">Executing Task...</span>
              </div>
              <span className="font-mono text-[11px] text-sky-400 font-bold">
                Step {currentStep} / {maxSteps}
              </span>
            </div>

            {liveStatus && (
              <div className="flex items-center gap-2 text-xs text-slate-300 font-mono bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800">
                <Terminal className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{liveStatus}</span>
              </div>
            )}
          </div>
        )}

        {/* Action Steps Timeline */}
        <StepTimeline steps={steps} />

        {/* Final Result Card */}
        {finalResult && (
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 rounded-xl p-3.5 space-y-2.5 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <Check className="h-4 w-4" />
                <span>Task Completed</span>
              </div>
              <button
                onClick={handleCopyResult}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed font-sans select-text">
              {finalResult}
            </div>
          </div>
        )}
      </div>

      {/* Input Box & Action Bar */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-900/90 backdrop-blur-md">
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="relative">
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Give a task on this tab (e.g. Find flights to NYC, extract data, click button)..."
              disabled={isRunning}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 resize-none disabled:opacity-50"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              Press <kbd className="bg-slate-800 px-1 rounded text-slate-400">Enter</kbd> to run
            </span>

            {isRunning ? (
              <button
                type="button"
                onClick={onStopTask}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-rose-600/20 transition-all"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!goal.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-sky-500/20 transition-all"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Start Task</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
