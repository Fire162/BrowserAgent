import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Loader2, Image as ImageIcon, X, Sparkles } from 'lucide-react';
import { StepRecord } from '../../core/agent/loop';
import { MarkdownViewer } from './MarkdownViewer';

interface StepTimelineProps {
  steps: StepRecord[];
  isRunning?: boolean;
  isPaused?: boolean;
}

export const StepTimeline: React.FC<StepTimelineProps> = ({ steps, isRunning = false, isPaused = false }) => {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  if (steps.length === 0) {
    return null;
  }

  const toggleExpand = (stepNumber: number) => {
    setExpandedStep(expandedStep === stepNumber ? null : stepNumber);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        Action Timeline ({steps.length})
      </div>
      <div className="space-y-1.5">
        {steps.map((step) => {
          const isActuallyRunning = isRunning && !isPaused && step.status === 'running' && !step.resultMessage;
          const isFailed =
            step.status === 'failed' ||
            (Boolean(step.resultMessage) &&
              (step.resultMessage!.includes('failed') ||
                step.resultMessage!.includes('Could not find') ||
                step.resultMessage!.includes('Error:')));

          const isExpanded = expandedStep === step.stepNumber || isActuallyRunning;

          return (
            <div
              key={step.stepNumber}
              className="bg-slate-900/70 border border-slate-800 rounded-lg overflow-hidden text-xs transition-colors"
            >
              <div
                onClick={() => toggleExpand(step.stepNumber)}
                className="p-2 flex items-center justify-between cursor-pointer hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isActuallyRunning ? (
                    <Loader2 className="h-3.5 w-3.5 text-sky-400 animate-spin shrink-0" />
                  ) : isFailed ? (
                    <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  )}

                  <span className="font-mono font-semibold text-slate-300">
                    Step {step.stepNumber}:
                  </span>

                  {step.toolCalls && step.toolCalls.length > 1 ? (
                    <span className="font-mono text-sky-300 font-medium truncate">
                      {step.toolCalls.map((t) => t.name).join(' + ')} ({step.toolCalls.length})
                    </span>
                  ) : step.toolCall ? (
                    <span className="font-mono text-sky-300 font-medium truncate">
                      {step.toolCall.name}
                      {step.toolCall.arguments?.elementId && `(#${step.toolCall.arguments.elementId})`}
                      {step.toolCall.arguments?.text && `("${step.toolCall.arguments.text.slice(0, 15)}")`}
                      {step.toolCall.arguments?.key && `("${step.toolCall.arguments.key}")`}
                    </span>
                  ) : (
                    <span className="text-slate-400 italic truncate">Observing page...</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 ml-2 shrink-0">
                  {step.steeringApplied && (
                    <span
                      title={`Priority Steering Applied: "${step.steeringApplied}"`}
                      className="text-[9px] text-amber-300 font-medium flex items-center gap-0.5 bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-500/30 shrink-0"
                    >
                      <Sparkles className="h-2.5 w-2.5 text-amber-400" />
                      <span>Steering</span>
                    </span>
                  )}
                  {step.screenshotUrl && (
                    <span className="text-[10px] text-sky-400 flex items-center gap-0.5 bg-sky-500/10 px-1 py-0.5 rounded border border-sky-500/20">
                      <ImageIcon className="h-3 w-3" />
                      <span>Snap</span>
                    </span>
                  )}
                  {step.costUSD !== undefined && step.costUSD > 0 && (
                    <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      +${step.costUSD.toFixed(4)}
                    </span>
                  )}
                  <div className="text-slate-500 hover:text-slate-300">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="px-3 pb-2.5 pt-1 border-t border-slate-800/80 space-y-2 bg-slate-950/40 text-[11px]">
                  {step.steeringApplied && (
                    <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400 uppercase tracking-wide">
                        <Sparkles className="h-3 w-3" />
                        <span>Live Steering Applied to this Step:</span>
                      </div>
                      <div className="mt-0.5 text-xs text-amber-100 font-medium whitespace-pre-wrap">
                        "{step.steeringApplied}"
                      </div>
                    </div>
                  )}

                  {step.thought && (
                    <div>
                      <span className="font-semibold text-slate-400 block mb-0.5">Reasoning:</span>
                      <div className="bg-slate-900/60 p-2 rounded border border-slate-800">
                        <MarkdownViewer content={step.thought} className="text-[11px]" />
                      </div>
                    </div>
                  )}

                  {step.screenshotUrl && (
                    <div>
                      <span className="font-semibold text-slate-400 block mb-1 flex items-center gap-1">
                        <ImageIcon className="h-3 w-3 text-sky-400" />
                        <span>Captured Screenshot (Click to expand):</span>
                      </span>
                      <img
                        src={step.screenshotUrl}
                        alt={`Screenshot step ${step.stepNumber}`}
                        onClick={() => setPreviewImage(step.screenshotUrl!)}
                        className="rounded-lg border border-slate-700/80 max-h-36 object-contain bg-black cursor-pointer hover:border-sky-400 transition-colors shadow-sm"
                      />
                    </div>
                  )}

                  {(step.toolCalls || step.toolCall) && (
                    <div>
                      <span className="font-semibold text-slate-400 block mb-0.5">
                        {step.toolCalls && step.toolCalls.length > 1 ? `Tool Actions (${step.toolCalls.length}):` : 'Tool Action:'}
                      </span>
                      <pre className="bg-slate-950 border border-slate-800/80 p-2 rounded text-[10px] text-sky-300 overflow-x-auto font-mono">
                        {JSON.stringify(step.toolCalls || step.toolCall, null, 2)}
                      </pre>
                    </div>
                  )}

                  {step.resultMessage && (
                    <div>
                      <span className="font-semibold text-slate-400 block mb-0.5">DOM Result:</span>
                      <div className="text-emerald-300/90 font-mono text-[10px]">
                        {step.resultMessage}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Fullscreen Screenshot Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col p-4 animate-fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <div className="flex justify-between items-center text-xs text-slate-300 mb-2">
            <span>Screenshot View</span>
            <button
              onClick={() => setPreviewImage(null)}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden">
            <img
              src={previewImage}
              alt="Fullscreen screenshot"
              className="max-h-full max-w-full object-contain rounded border border-slate-800"
            />
          </div>
        </div>
      )}
    </div>
  );
};
