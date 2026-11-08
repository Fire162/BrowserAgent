import React, { useState, useEffect } from 'react';
import { History, Trash2, CheckCircle, XCircle, Clock, ArrowRight, MessageSquare, Play } from 'lucide-react';
import { loadTasks, clearTasks, TaskRecord } from '../../core/storage/db';
import { MarkdownViewer } from './MarkdownViewer';

interface HistoryViewProps {
  onRerunTask: (goal: string) => void;
  onResumeTaskInChat: (task: TaskRecord) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onRerunTask, onResumeTaskInChat }) => {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskRecord | null>(null);

  useEffect(() => {
    loadTasks().then(setTasks);
  }, []);

  const handleClear = async () => {
    if (confirm('Clear all task history?')) {
      await clearTasks();
      setTasks([]);
      setSelectedTask(null);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-200">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white flex items-center gap-1.5">
          <History className="h-4 w-4 text-sky-400" />
          <span>Execution History</span>
        </h3>
        {tasks.length > 0 && (
          <button
            onClick={handleClear}
            className="text-slate-400 hover:text-rose-400 flex items-center gap-1 text-[11px] transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No past tasks found.</p>
          <p className="text-[11px] mt-1">Run an agent task to see its log here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 hover:border-slate-700 transition-colors cursor-pointer group"
              onClick={() => setSelectedTask(task)}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-medium text-white line-clamp-2">{task.goal}</span>
                {task.status === 'completed' ? (
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                )}
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2">
                <span>{task.provider} • {task.model.split('/').pop()}</span>
                <div className="flex items-center gap-2">
                  <span>{task.stepCount} steps • {formatDate(task.createdAt)}</span>
                  <span className="text-sky-400 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity font-medium">
                    <span>Open</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Task Details Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 flex flex-col justify-end">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 max-h-[85vh] overflow-y-auto space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono text-sky-400">{selectedTask.provider}</span>
                <h4 className="font-semibold text-white text-sm">{selectedTask.goal}</h4>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="text-slate-400 hover:text-white text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {selectedTask.resultSummary && (
              <div>
                <span className="text-[11px] font-semibold text-slate-400 block mb-1">Result:</span>
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <MarkdownViewer content={selectedTask.resultSummary} className="text-[11px]" />
                </div>
              </div>
            )}

            <div className="pt-2 flex gap-2">
              <button
                onClick={() => {
                  onResumeTaskInChat(selectedTask);
                  setSelectedTask(null);
                }}
                className="flex-1 py-1.5 px-3 bg-sky-500 hover:bg-sky-400 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-sky-500/20"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Resume / Open in Chat</span>
              </button>

              <button
                onClick={() => {
                  onRerunTask(selectedTask.goal);
                  setSelectedTask(null);
                }}
                className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
              >
                Rerun
              </button>

              <button
                onClick={() => setSelectedTask(null)}
                className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
