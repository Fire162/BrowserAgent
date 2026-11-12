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

export async function callGemini(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  temperature = 0.2,
  onStatusNotice?: (msg: string) => void,
  signal?: AbortSignal
): Promise<LLMCompletionResponse> {
  if (!apiKey) {
    throw new Error('Google API key is required. Please set it in Settings.');
  }

  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const contents: any[] = [];

  for (let i = 0; i < chatMessages.length; i++) {
    const m = chatMessages[i];

    if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) {
        parts.push({ text: m.content });
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        m.toolCalls.forEach((tc) => {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments || {},
            },
          });
        });
      }
      contents.push({
        role: 'model',
        parts: parts.length > 0 ? parts : [{ text: '' }],
      });
    } else if (m.role === 'tool') {
      // Find actual tool function name matching Gemini functionDeclarations
      let fnName = m.toolName;
      if (!fnName && m.toolCallId) {
        for (let j = i - 1; j >= 0; j--) {
          const prev = chatMessages[j];
          if (prev.role === 'assistant' && prev.toolCalls) {
            const match = prev.toolCalls.find((tc) => tc.id === m.toolCallId);
            if (match) {
              fnName = match.name;
              break;
            }
          }
        }
      }
      fnName = fnName || 'action';

      const part = {
        functionResponse: {
          name: fnName,
          response: { result: m.content },
        },
      };

      // Merge consecutive tool responses into the same user turn
      const lastContent = contents[contents.length - 1];
      if (lastContent && lastContent.role === 'user' && lastContent.parts.some((p: any) => p.functionResponse)) {
        lastContent.parts.push(part);
      } else {
        contents.push({
          role: 'user',
          parts: [part],
        });
      }
    } else if (m.role === 'user') {
      const userParts: any[] = [{ text: m.content }];
      if (m.imageUrl) {
        const { mimeType, data } = parseDataUrl(m.imageUrl);
        userParts.push({
          inlineData: {
            mimeType,
            data,
          },
        });
      }

      // If preceding turn is also user (e.g. tool response), merge to preserve strict user/model alternation
      const lastContent = contents[contents.length - 1];
      if (lastContent && lastContent.role === 'user') {
        lastContent.parts.push(...userParts);
      } else {
        contents.push({
          role: 'user',
          parts: userParts,
        });
      }
    }
  }

  const functionDeclarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const payload: any = {
    contents,
    generationConfig: {
      temperature,
    },
  };

  if (systemMessage) {
    payload.systemInstruction = {
      parts: [{ text: systemMessage.content }],
    };
  }

  if (functionDeclarations.length > 0) {
    payload.tools = [{ functionDeclarations }];
  }

  const cleanModel = model.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    onRetryNotice: onStatusNotice,
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google API error (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  const candidate = json.candidates?.[0];
  if (!candidate) {
    throw new Error('Google Gemini returned an empty candidate list.');
  }

  const parts = candidate.content?.parts || [];
  let text = '';
  const toolCalls: any[] = [];

  parts.forEach((p: any, idx: number) => {
    if (p.text) {
      text += p.text;
    }
    if (p.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${idx}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args || {},
      });
    }
  });

  const promptTokens = json.usageMetadata?.promptTokenCount || 0;
  const completionTokens = json.usageMetadata?.candidatesTokenCount || 0;
  const cachedTokens = json.usageMetadata?.cachedContentTokenCount || 0;
  const estimatedCost = estimateCostUSD(model, promptTokens, completionTokens, undefined, cachedTokens);

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    rawResponse: json,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: json.usageMetadata?.totalTokenCount || (promptTokens + completionTokens),
      cachedTokens,
    },
    estimatedCostUSD: estimatedCost,
  };
}
