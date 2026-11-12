import { AllSettings } from '../llm/types';
import { DEFAULT_SETTINGS } from '../llm/providers/registry';

export interface TaskRecord {
  id: string;
  goal: string;
  provider: string;
  model: string;
  status: 'completed' | 'failed' | 'aborted' | 'paused';
  stepCount: number;
  resultSummary?: string;
  steps?: any[];
  messages?: any[];
  turns?: any[];
  createdAt: number;
  completedAt?: number;
}

const SETTINGS_KEY = 'browseragent_settings';
const TASKS_KEY = 'browseragent_tasks';

// Check if chrome.storage is available
const isExtensionEnv = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

export async function loadSettings(): Promise<AllSettings> {
  if (!isExtensionEnv) {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (res) => {
      if (res && res[SETTINGS_KEY]) {
        try {
          const parsed = typeof res[SETTINGS_KEY] === 'string' ? JSON.parse(res[SETTINGS_KEY]) : res[SETTINGS_KEY];
          resolve({
            ...DEFAULT_SETTINGS,
            ...parsed,
            providers: {
              ...DEFAULT_SETTINGS.providers,
              ...(parsed.providers || {}),
            },
            agent: {
              ...DEFAULT_SETTINGS.agent,
              ...(parsed.agent || {}),
            },
          });
        } catch {
          resolve(DEFAULT_SETTINGS);
        }
      } else {
        resolve(DEFAULT_SETTINGS);
      }
    });
  });
}

export async function saveSettings(settings: AllSettings): Promise<void> {
  if (!isExtensionEnv) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return;
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
      resolve();
    });
  });
}

export async function loadTasks(): Promise<TaskRecord[]> {
  if (!isExtensionEnv) {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([TASKS_KEY], (res) => {
      if (res && res[TASKS_KEY]) {
        try {
          const tasks = typeof res[TASKS_KEY] === 'string' ? JSON.parse(res[TASKS_KEY]) : res[TASKS_KEY];
          resolve(Array.isArray(tasks) ? tasks : []);
        } catch {
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  });
}

function sanitizeTaskForStorage(task: TaskRecord): TaskRecord {
  return {
    ...task,
    steps: task.steps?.map((step) => {
      // Keep step metadata; if screenshot is exceptionally large (>300KB), omit it from persistent storage
      const screenshotUrl =
        step.screenshotUrl && step.screenshotUrl.length > 300_000
          ? undefined
          : step.screenshotUrl;
      return {
        ...step,
        screenshotUrl,
      };
    }),
    messages: task.messages?.map((msg) => {
      let content = msg.content;
      // If content contains huge DOM representation, compress/prune for storage
      if (typeof content === 'string' && content.length > 3000 && content.includes('Interactive Elements:')) {
        const lines = content.split('\n');
        const header = lines.slice(0, 8).join('\n');
        content = `${header}\n\n... [${lines.length - 8} lines of page DOM pruned for history storage]`;
      }
      return {
        ...msg,
        content,
        imageUrl: undefined, // Never duplicate full-resolution base64 images inside raw message storage
      };
    }),
  };
}

export async function saveTask(task: TaskRecord): Promise<void> {
  const sanitized = sanitizeTaskForStorage(task);
  const current = await loadTasks();
  let updated = [sanitized, ...current.filter((t) => t.id !== task.id)].slice(0, 30);

  if (!isExtensionEnv) {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(updated));
    } catch {
      try {
        localStorage.setItem(TASKS_KEY, JSON.stringify(updated.slice(0, 10)));
      } catch {}
    }
    return;
  }

  const trySave = (items: TaskRecord[]): Promise<void> => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [TASKS_KEY]: items }, () => {
        if (chrome.runtime?.lastError) {
          console.warn('Storage set error:', chrome.runtime.lastError.message);
          // If quota exceeded or error, aggressively trim older tasks
          if (items.length > 5) {
            chrome.storage.local.set({ [TASKS_KEY]: items.slice(0, 10) }, () => resolve());
            return;
          }
        }
        resolve();
      });
    });
  };

  await trySave(updated);
}

export async function clearTasks(): Promise<void> {
  if (!isExtensionEnv) {
    localStorage.removeItem(TASKS_KEY);
    return;
  }

  return new Promise((resolve) => {
    chrome.storage.local.remove([TASKS_KEY], () => {
      resolve();
    });
  });
}
