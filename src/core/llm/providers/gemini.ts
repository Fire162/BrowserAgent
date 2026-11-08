import { ChatMessage, LLMCompletionResponse, ToolDefinition } from '../types';

export async function callGemini(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  temperature = 0.2
): Promise<LLMCompletionResponse> {
  if (!apiKey) {
    throw new Error('Google Gemini API key is required. Please set it in Settings.');
  }

  // Separate system instruction from messages
  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const contents = chatMessages.map((m) => {
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
              args: tc.arguments,
            },
          });
        });
      }
      return {
        role: 'model',
        parts: parts.length > 0 ? parts : [{ text: '' }],
      };
    }

    if (m.role === 'tool') {
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.toolCallId || 'tool_response',
              response: { result: m.content },
            },
          },
        ],
      };
    }

    return {
      role: 'user',
      parts: [{ text: m.content }],
    };
  });

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

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Gemini API error (${res.status}): ${errorText}`);
  }

  const json = await res.json();
  const candidate = json.candidates?.[0];
  if (!candidate) {
    throw new Error('Gemini returned an empty candidate list.');
  }

  const parts = candidate.content?.parts || [];
  let text = '';
  const toolCalls: any[] = [];

  parts.forEach((p: any) => {
    if (p.text) {
      text += p.text;
    }
    if (p.functionCall) {
      toolCalls.push({
        name: p.functionCall.name,
        arguments: p.functionCall.args || {},
      });
    }
  });

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    rawResponse: json,
    usage: json.usageMetadata ? {
      promptTokens: json.usageMetadata.promptTokenCount,
      completionTokens: json.usageMetadata.candidatesTokenCount,
      totalTokens: json.usageMetadata.totalTokenCount,
    } : undefined,
  };
}
