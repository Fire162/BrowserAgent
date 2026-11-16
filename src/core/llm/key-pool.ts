import { ProviderId, ProviderSettings, KeyRotationStrategy } from './types';

export interface KeyPoolRuntimeState {
  currentIndex: number;
  activeKeyIndex: number;
}

// In-memory runtime state tracking for key indices per provider across calls
const providerPoolStates: Partial<Record<ProviderId, KeyPoolRuntimeState>> = {};

function getPoolState(providerId: ProviderId): KeyPoolRuntimeState {
  if (!providerPoolStates[providerId]) {
    providerPoolStates[providerId] = {
      currentIndex: 0,
      activeKeyIndex: 0,
    };
  }
  return providerPoolStates[providerId]!;
}

/**
 * Normalizes input which may be an array, or a string containing multiple keys
 * separated by newlines, commas, or semicolons.
 */
export function normalizeApiKeys(input?: string[] | string): string[] {
  if (!input) return [];
  const rawList: string[] = Array.isArray(input) ? input : input.split(/[\n,;]+/);
  const result: string[] = [];

  for (const item of rawList) {
    const trimmed = item.trim();
    if (trimmed && !trimmed.startsWith('#') && !result.includes(trimmed)) {
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Returns all usable API keys for a provider from either apiKeys array or apiKey string.
 */
export function getProviderApiKeys(config?: ProviderSettings): string[] {
  if (!config) return [];
  const keys: string[] = [];

  if (Array.isArray(config.apiKeys) && config.apiKeys.length > 0) {
    for (const k of config.apiKeys) {
      const trimmed = k.trim();
      if (trimmed && !trimmed.startsWith('#') && !keys.includes(trimmed)) {
        keys.push(trimmed);
      }
    }
  }

  if (config.apiKey && config.apiKey.trim()) {
    const fromSingle = normalizeApiKeys(config.apiKey);
    for (const k of fromSingle) {
      if (!keys.includes(k)) {
        keys.push(k);
      }
    }
  }

  return keys;
}

/**
 * Safely masks an API key for UI/logs, showing prefix and suffix:
 * e.g., "sk-proj-abc...1234"
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const prefixLen = Math.min(6, Math.floor(trimmed.length / 3));
  const suffixLen = Math.min(4, Math.floor(trimmed.length / 4));
  return `${trimmed.slice(0, prefixLen)}...${trimmed.slice(-suffixLen)}`;
}

/**
 * Determines whether an error is candidate for key rotation (rate limit, quota, auth, server overload).
 */
export function isKeyRotationError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const status = err.status || err.statusCode || err.code;

  if (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests')
  ) {
    return true;
  }

  if (
    status === 401 ||
    status === 403 ||
    msg.includes('quota') ||
    msg.includes('insufficient_quota') ||
    msg.includes('credit') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid api key') ||
    msg.includes('resource_exhausted') ||
    msg.includes('exceeded your current quota')
  ) {
    return true;
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('overloaded') ||
    msg.includes('service unavailable')
  ) {
    return true;
  }

  return false;
}

export interface KeySelection {
  key: string;
  index: number;
  total: number;
  strategy: KeyRotationStrategy;
}

/**
 * Picks the initial key for a request given the pool and chosen strategy.
 */
export function selectInitialKey(
  providerId: ProviderId,
  keys: string[],
  strategy: KeyRotationStrategy = 'use_until_error'
): KeySelection {
  if (keys.length === 0) {
    throw new Error(`No API keys available for provider "${providerId}".`);
  }

  const state = getPoolState(providerId);

  if (strategy === 'random') {
    const idx = Math.floor(Math.random() * keys.length);
    return {
      key: keys[idx],
      index: idx,
      total: keys.length,
      strategy,
    };
  }

  if (strategy === 'round_robin') {
    const idx = state.currentIndex % keys.length;
    state.currentIndex = (idx + 1) % keys.length;
    return {
      key: keys[idx],
      index: idx,
      total: keys.length,
      strategy,
    };
  }

  // 'use_until_error'
  const idx = state.activeKeyIndex % keys.length;
  return {
    key: keys[idx],
    index: idx,
    total: keys.length,
    strategy,
  };
}

/**
 * Rotates to the next key when an error occurs with the current key.
 */
export function rotateKeyOnError(
  providerId: ProviderId,
  keys: string[],
  failedIndex: number,
  strategy: KeyRotationStrategy
): KeySelection {
  const state = getPoolState(providerId);

  if (strategy === 'random') {
    if (keys.length <= 1) {
      return { key: keys[0], index: 0, total: 1, strategy };
    }
    // Pick any key other than the one that just failed
    let newIdx = Math.floor(Math.random() * (keys.length - 1));
    if (newIdx >= failedIndex) newIdx++;
    return {
      key: keys[newIdx],
      index: newIdx,
      total: keys.length,
      strategy,
    };
  }

  // For both round_robin and use_until_error, advance sequentially
  const nextIdx = (failedIndex + 1) % keys.length;
  state.activeKeyIndex = nextIdx;
  state.currentIndex = (nextIdx + 1) % keys.length;

  return {
    key: keys[nextIdx],
    index: nextIdx,
    total: keys.length,
    strategy,
  };
}

/**
 * Executes an LLM operation with the key pool, automatically handling
 * strategy-based key selection, failure detection, and automatic failover/rotation.
 */
export async function executeWithKeyPool<T>(
  providerId: ProviderId,
  keys: string[],
  strategy: KeyRotationStrategy,
  dispatchFn: (apiKey: string) => Promise<T>,
  onStatusNotice?: (msg: string) => void
): Promise<T> {
  if (keys.length === 0) {
    return dispatchFn('');
  }

  if (keys.length === 1) {
    return dispatchFn(keys[0]);
  }

  let currentSelection = selectInitialKey(providerId, keys, strategy);
  const attemptedIndices = new Set<number>();
  let lastError: any = null;

  while (attemptedIndices.size < keys.length) {
    attemptedIndices.add(currentSelection.index);

    try {
      return await dispatchFn(currentSelection.key);
    } catch (err: any) {
      lastError = err;

      // Check if error is eligible for key rotation and more keys remain
      const canRotate = isKeyRotationError(err) && attemptedIndices.size < keys.length;

      if (!canRotate) {
        throw err;
      }

      const maskedOldKey = maskApiKey(currentSelection.key);
      const nextSelection = rotateKeyOnError(
        providerId,
        keys,
        currentSelection.index,
        strategy
      );
      const maskedNewKey = maskApiKey(nextSelection.key);

      const notice = `🔄 [Key Pool (${strategy})] Key #${currentSelection.index + 1} (${maskedOldKey}) encountered error (${err.message || 'Rate Limit'}). Switching to Key #${nextSelection.index + 1} (${maskedNewKey})...`;
      onStatusNotice?.(notice);

      currentSelection = nextSelection;
    }
  }

  throw lastError || new Error(`All ${keys.length} API keys in pool failed.`);
}
