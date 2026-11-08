import { AllSettings } from '../llm/types';
import { DEFAULT_SETTINGS } from '../llm/providers/registry';

export interface TaskRecord {
  id: string;
  goal: string;
  provider: string;
  model: string;
  status: 'completed' | 'failed' | 'aborted';
  stepCount: number;
  resultSummary?: string;
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

export async function saveTask(task: TaskRecord): Promise<void> {
  const current = await loadTasks();
  const updated = [task, ...current.filter((t) => t.id !== task.id)].slice(0, 50); // Keep last 50 tasks

  if (!isExtensionEnv) {
    localStorage.setItem(TASKS_KEY, JSON.stringify(updated));
    return;
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ [TASKS_KEY]: updated }, () => {
      resolve();
    });
  });
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
