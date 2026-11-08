import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Loader2, Play } from 'lucide-react';
import { StepRecord } from '../../core/agent/loop';

interface StepTimelineProps {
  steps: StepRecord[];
}

export const StepTimeline: React.FC<StepTimelineProps> = ({ steps }) => {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

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
          const isExpanded = expandedStep === step.stepNumber || step.status === 'running';

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
                  {step.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 text-sky-400 animate-spin shrink-0" />
                  ) : step.status === 'success' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  )}

                  <span className="font-mono font-semibold text-slate-300">
                    Step {step.stepNumber}:
                  </span>

                  {step.toolCall ? (
                    <span className="font-mono text-sky-300 font-medium truncate">
                      {step.toolCall.name}
                      {step.toolCall.arguments.elementId && `(#${step.toolCall.arguments.elementId})`}
                      {step.toolCall.arguments.text && `("${step.toolCall.arguments.text.slice(0, 15)}")`}
                      {step.toolCall.arguments.key && `("${step.toolCall.arguments.key}")`}
                    </span>
                  ) : (
                    <span className="text-slate-400 italic truncate">Observing page...</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 ml-2 shrink-0">
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
                  {step.thought && (
                    <div>
                      <span className="font-semibold text-slate-400 block mb-0.5">Reasoning:</span>
                      <p className="text-slate-300 leading-relaxed font-sans">{step.thought}</p>
                    </div>
                  )}

                  {step.toolCall && (
                    <div>
                      <span className="font-semibold text-slate-400 block mb-0.5">Tool Action:</span>
                      <pre className="bg-slate-950 border border-slate-800/80 p-2 rounded text-[10px] text-sky-300 overflow-x-auto font-mono">
                        {JSON.stringify(step.toolCall, null, 2)}
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
    </div>
  );
};
