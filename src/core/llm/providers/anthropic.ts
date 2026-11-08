import { ChatMessage, LLMCompletionResponse, ToolDefinition } from '../types';
import { fetchWithRetry } from '../http';
import { estimateCostUSD } from '../pricing';

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: 'image/jpeg', data: dataUrl };
}

export async function callAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  temperature = 0.2,
  onStatusNotice?: (msg: string) => void
): Promise<LLMCompletionResponse> {
  if (!apiKey) {
    throw new Error('Anthropic API key is required. Please set it in Settings.');
  }

  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const formattedMessages: any[] = [];

  for (const m of chatMessages) {
    if (m.role === 'user') {
      if (m.imageUrl) {
        const { mimeType, data } = parseDataUrl(m.imageUrl);
        formattedMessages.push({
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: data,
              },
            },
            {
              type: 'text',
              text: m.content,
            },
          ],
        });
      } else {
        formattedMessages.push({
          role: 'user',
          content: m.content,
        });
      }
    } else if (m.role === 'assistant') {
      const contentBlocks: any[] = [];
      if (m.content) {
        contentBlocks.push({ type: 'text', text: m.content });
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        m.toolCalls.forEach((tc, idx) => {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id || `tool_${Date.now()}_${idx}`,
            name: tc.name,
            input: tc.arguments,
          });
        });
      }
      formattedMessages.push({
        role: 'assistant',
        content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
      });
    } else if (m.role === 'tool') {
      const toolContentBlocks: any[] = [];
      if (m.imageUrl) {
        const { mimeType, data } = parseDataUrl(m.imageUrl);
        toolContentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: data,
          },
        });
      }
      toolContentBlocks.push({
        type: 'text',
        text: m.content,
      });

      formattedMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId || '',
            content: toolContentBlocks,
          },
        ],
      });
    }
  }

  const formattedTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: t.parameters.properties,
      required: t.parameters.required || [],
    },
  }));

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature,
      system: systemMessage?.content,
      messages: formattedMessages,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
    }),
    onRetryNotice: onStatusNotice,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  let text = '';
  const toolCalls: any[] = [];

  if (Array.isArray(json.content)) {
    for (const block of json.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input || {},
        });
      }
    }
  }

  const promptTokens = json.usage?.input_tokens || 0;
  const completionTokens = json.usage?.output_tokens || 0;
  const estimatedCost = estimateCostUSD(model, promptTokens, completionTokens);

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    rawResponse: json,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    estimatedCostUSD: estimatedCost,
  };
}
