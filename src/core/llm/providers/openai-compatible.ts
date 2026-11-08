import { ChatMessage, LLMCompletionResponse, ToolDefinition } from '../types';

export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  customHeaders?: Record<string, string>;
  providerName: string;
}

export async function callOpenAICompatible({
  apiKey,
  baseUrl,
  model,
  messages,
  tools,
  temperature = 0.2,
  customHeaders = {},
  providerName,
}: OpenAICompatibleOptions): Promise<LLMCompletionResponse> {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = cleanBaseUrl.endsWith('/chat/completions')
    ? cleanBaseUrl
    : `${cleanBaseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
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

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      temperature,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`${providerName} API error (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  if (!choice) {
    throw new Error(`${providerName} returned an empty response.`);
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

  return {
    text: choice.message?.content || '',
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    rawResponse: json,
    usage: json.usage ? {
      promptTokens: json.usage.prompt_tokens,
      completionTokens: json.usage.completion_tokens,
      totalTokens: json.usage.total_tokens,
    } : undefined,
  };
}
