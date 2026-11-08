import { ProviderId, ModelOption } from './types';
import { PROVIDERS } from './providers/registry';

export async function fetchLiveProviderModels(
  providerId: ProviderId,
  apiKey: string,
  customBaseUrl?: string
): Promise<ModelOption[]> {
  const fallback = PROVIDERS[providerId]?.models || [];

  try {
    switch (providerId) {
      case 'openrouter': {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data) && json.data.length > 0) {
            return json.data.map((m: any) => ({
              id: m.id,
              name: m.name || m.id,
              description: m.description ? m.description.slice(0, 90) + '...' : undefined,
              contextWindow: m.context_length,
            }));
          }
        }
        return fallback;
      }

      case 'openai':
      case 'deepseek':
      case 'alibaba':
      case 'xai':
      case 'zai':
      case 'mistral':
      case 'custom': {
        const baseUrl = (customBaseUrl || PROVIDERS[providerId]?.defaultBaseUrl || '').replace(/\/+$/, '');
        const res = await fetch(`${baseUrl}/models`, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        if (res.ok) {
          const json = await res.json();
          const list = json.data || json.models;
          if (Array.isArray(list) && list.length > 0) {
            return list.map((m: any) => ({
              id: m.id || m.name,
              name: m.id || m.name,
            }));
          }
        }
        return fallback;
      }

      case 'google': {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.models) && json.models.length > 0) {
            return json.models
              .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
              .map((m: any) => ({
                id: m.name.replace(/^models\//, ''),
                name: m.displayName || m.name.replace(/^models\//, ''),
              }));
          }
        }
        return fallback;
      }

      default:
        return fallback;
    }
  } catch (err) {
    console.warn(`[BrowserAgent] Endpoint query failed, using configured models for ${providerId}:`, err);
    return fallback;
  }
}
