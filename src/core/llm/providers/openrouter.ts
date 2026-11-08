import { ChatMessage, LLMCompletionResponse, ToolDefinition, ModelOption } from '../types';
import { fetchWithRetry } from '../http';
import { estimateCostUSD } from '../pricing';

export async function fetchOpenRouterModels(apiKey?: string): Promise<ModelOption[]> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetchWithRetry('https://openrouter.ai/api/v1/models', {
      headers,
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data.map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
      description: m.description ? m.description.slice(0, 100) + '...' : undefined,
      contextWindow: m.context_length,
      recommended: [
        'openai/gpt-6-astra',
        'anthropic/claude-opus-5-5',
        'google/gemini-4-argon',
        'deepseek/deepseek-v4-pro',
      ].includes(m.id),
    }));
  } catch (err) {
    console.warn('[OpenRouter] Model fetch failed, using fallback:', err);
    return [];
  }
}

export async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  temperature = 0.2,
  onStatusNotice?: (msg: string) => void
): Promise<LLMCompletionResponse> {
  if (!apiKey) {
    throw new Error('OpenRouter API key is required. Please set it in Settings.');
  }

  const formattedMessages = messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc, idx) => ({
          id: tc.id || `call_${idx}_${Date.now()}`,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }
    if (m.role === 'user') {
      if (m.imageUrl) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: m.content },
            {
              type: 'image_url',
              image_url: {
                url: m.imageUrl,
              },
            },
          ],
        };
      }
      return {
        role: 'user',
        content: m.content,
      };
    }
    return {
      role: m.role,
      content: m.content,
    };
  });

  const formattedTools = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const res = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/Fire162/BrowserAgent',
      'X-Title': 'BrowserAgent Extension',
    },
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      temperature,
    }),
    onRetryNotice: onStatusNotice,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  if (!choice) {
    throw new Error('OpenRouter returned an empty response.');
  }

  const toolCalls = choice.message?.tool_calls?.map((tc: any) => {
    let args = {};
    try {
      args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
    } catch {
      args = { raw: tc.function.arguments };
    }
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
    };
  });

  const promptTokens = json.usage?.prompt_tokens || 0;
  const completionTokens = json.usage?.completion_tokens || 0;
  const estimatedCost = estimateCostUSD(model, promptTokens, completionTokens, json.usage?.total_cost);

  return {
    text: choice.message?.content || '',
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    rawResponse: json,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: json.usage?.total_tokens || (promptTokens + completionTokens),
    },
    estimatedCostUSD: estimatedCost,
  };
}
