import { AllSettings, ChatMessage, LLMCompletionResponse, ToolDefinition } from './types';
import { PROVIDERS } from './providers/registry';
import { callOpenRouter } from './providers/openrouter';
import { callGemini } from './providers/gemini';
import { callAnthropic } from './providers/anthropic';
import { callOpenAICompatible } from './providers/openai-compatible';

export async function executeLLMCall(
  settings: AllSettings,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LLMCompletionResponse> {
  const providerId = settings.activeProvider;
  const providerConfig = settings.providers[providerId];
  const providerDef = PROVIDERS[providerId];

  if (!providerConfig) {
    throw new Error(`Provider configuration for "${providerId}" not found.`);
  }

  const model = providerConfig.customModelId?.trim() || providerConfig.selectedModel || providerDef.defaultModel;
  const apiKey = providerConfig.apiKey?.trim();
  const temperature = settings.agent.temperature ?? 0.2;

  switch (providerId) {
    case 'openrouter':
      return callOpenRouter(apiKey, model, messages, tools, temperature);

    case 'gemini':
      return callGemini(apiKey, model, messages, tools, temperature);

    case 'anthropic':
      return callAnthropic(apiKey, model, messages, tools, temperature);

    case 'openai':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.openai.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'OpenAI',
      });

    case 'grok':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.grok.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'xAI Grok',
      });

    case 'deepseek':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.deepseek.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'DeepSeek',
      });

    case 'custom':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.custom.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'Custom Endpoint',
      });

    default:
      throw new Error(`Unsupported provider: ${providerId}`);
  }
}
