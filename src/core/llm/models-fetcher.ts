import { ProviderId, ModelOption } from './types';
import { PROVIDERS } from './providers/registry';

export async function fetchLiveProviderModels(
  providerId: ProviderId,
  apiKey: string,
  customBaseUrl?: string
): Promise<ModelOption[]> {
  try {
    switch (providerId) {
      case 'openrouter':
        return await fetchOpenRouterLive(apiKey);

      case 'gemini':
        return await fetchGeminiLive(apiKey);

      case 'anthropic':
        return await fetchAnthropicLive(apiKey);

      case 'openai':
        return await fetchOpenAILive(apiKey, customBaseUrl);

      case 'grok':
        return await fetchGrokLive(apiKey, customBaseUrl);

      case 'deepseek':
        return await fetchDeepSeekLive(apiKey, customBaseUrl);

      case 'custom':
        return await fetchCustomLive(apiKey, customBaseUrl);

      default:
        return PROVIDERS[providerId]?.models || [];
    }
  } catch (err: any) {
    console.warn(`[BrowserAgent] Failed to fetch live models for ${providerId}:`, err);
    throw err;
  }
}

// 1. OpenRouter
async function fetchOpenRouterLive(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });

  if (!res.ok) throw new Error(`OpenRouter (${res.status}): ${res.statusText}`);
  const json = await res.json();
  if (!Array.isArray(json.data)) return [];

  return json.data.map((m: any) => ({
    id: m.id,
    name: m.name || m.id,
    description: m.description ? m.description.slice(0, 90) + '...' : undefined,
    contextWindow: m.context_length,
    recommended: [
      'anthropic/claude-3.7-sonnet',
      'deepseek/deepseek-r1',
      'google/gemini-2.0-flash-001',
      'openai/gpt-4o',
    ].includes(m.id),
  }));
}

// 2. Google Gemini
async function fetchGeminiLive(apiKey: string): Promise<ModelOption[]> {
  if (!apiKey) throw new Error('API key required to fetch Google Gemini models.');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google AI Studio (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  if (!Array.isArray(json.models)) return [];

  // Filter models that support content generation and strip 'models/' prefix
  return json.models
    .filter((m: any) => {
      const methods: string[] = m.supportedGenerationMethods || [];
      return methods.includes('generateContent') && !m.name.includes('embedding') && !m.name.includes('aqa');
    })
    .map((m: any) => {
      const cleanId = m.name.replace(/^models\//, '');
      const isRecommended =
        cleanId.includes('2.0-flash') ||
        cleanId.includes('2.5-pro') ||
        cleanId.includes('3.') ||
        cleanId.includes('pro-exp');

      return {
        id: cleanId,
        name: m.displayName || cleanId,
        description: m.description ? m.description.slice(0, 90) + '...' : `Context: ${m.inputTokenLimit?.toLocaleString() || '1M+'} tokens`,
        contextWindow: m.inputTokenLimit,
        recommended: isRecommended,
      };
    })
    .sort((a: ModelOption, b: ModelOption) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
}

// 3. Anthropic Claude
async function fetchAnthropicLive(apiKey: string): Promise<ModelOption[]> {
  if (!apiKey) throw new Error('API key required to fetch Anthropic models.');

  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });

    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.data)) {
        return json.data.map((m: any) => ({
          id: m.id,
          name: m.display_name || m.id,
          description: `Created: ${m.created_at ? new Date(m.created_at).toLocaleDateString() : 'Active'}`,
          recommended: m.id.includes('3-7-sonnet') || m.id.includes('3-5-sonnet'),
        }));
      }
    }
  } catch {
    // Fallback if list endpoint has CORS or permission limits
  }

  // Modern frontier Anthropic catalog
  return [
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', description: 'Frontier hybrid reasoning and elite browser coding', recommended: true },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (v2)', description: 'Previous benchmark for web agent automation', recommended: true },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast, high efficiency model for simple tasks' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Deep qualitative analysis' },
  ];
}

// 4. OpenAI
async function fetchOpenAILive(apiKey: string, customBaseUrl?: string): Promise<ModelOption[]> {
  if (!apiKey) throw new Error('API key required to fetch OpenAI models.');

  const baseUrl = (customBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`OpenAI (${res.status}): ${res.statusText}`);
  const json = await res.json();
  if (!Array.isArray(json.data)) return [];

  // Filter for chat and reasoning models only
  const validPrefixes = ['gpt-4', 'o1', 'o3', 'chatgpt'];
  return json.data
    .filter((m: any) => validPrefixes.some((p) => m.id.startsWith(p)) && !m.id.includes('audio') && !m.id.includes('realtime'))
    .map((m: any) => ({
      id: m.id,
      name: m.id,
      description: m.owned_by ? `Owner: ${m.owned_by}` : undefined,
      recommended: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1'].includes(m.id),
    }))
    .sort((a: ModelOption, b: ModelOption) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
}

// 5. xAI Grok
async function fetchGrokLive(apiKey: string, customBaseUrl?: string): Promise<ModelOption[]> {
  if (!apiKey) throw new Error('API key required to fetch Grok models.');

  const baseUrl = (customBaseUrl || 'https://api.x.ai/v1').replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`xAI (${res.status}): ${res.statusText}`);
  const json = await res.json();
  if (!Array.isArray(json.data)) return [];

  return json.data.map((m: any) => ({
    id: m.id,
    name: m.id,
    recommended: m.id.includes('grok-2'),
  }));
}

// 6. DeepSeek
async function fetchDeepSeekLive(apiKey: string, customBaseUrl?: string): Promise<ModelOption[]> {
  if (!apiKey) throw new Error('API key required to fetch DeepSeek models.');

  const baseUrl = (customBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.data)) {
        return json.data.map((m: any) => ({
          id: m.id,
          name: m.id,
          recommended: m.id.includes('chat') || m.id.includes('reasoner'),
        }));
      }
    }
  } catch {
    // Fallback
  }

  return [
    { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)', description: 'General conversational & tool calling model', recommended: true },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)', description: 'Specialized deep reasoning model', recommended: true },
  ];
}

// 7. Custom / Local (Ollama, LM Studio, etc.)
async function fetchCustomLive(apiKey?: string, customBaseUrl?: string): Promise<ModelOption[]> {
  const rawUrl = (customBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');

  // Check Ollama tags endpoint
  if (rawUrl.includes('11434') || rawUrl.includes('ollama')) {
    try {
      const ollamaRoot = rawUrl.replace(/\/v1\/?$/, '');
      const res = await fetch(`${ollamaRoot}/api/tags`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.models)) {
          return json.models.map((m: any) => ({
            id: m.name,
            name: m.name,
            description: m.details ? `${m.details.parameter_size || ''} ${m.details.family || ''}` : undefined,
            recommended: true,
          }));
        }
      }
    } catch {
      // Fall through to /models
    }
  }

  // Standard OpenAI /models endpoint
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const cleanBase = rawUrl.endsWith('/v1') ? rawUrl : `${rawUrl}/v1`;
  const res = await fetch(`${cleanBase}/models`, { headers });
  if (!res.ok) throw new Error(`Custom endpoint (${res.status}): ${res.statusText}`);

  const json = await res.json();
  if (Array.isArray(json.data)) {
    return json.data.map((m: any) => ({
      id: m.id,
      name: m.id,
    }));
  }

  return [];
}
