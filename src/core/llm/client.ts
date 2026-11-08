import { AllSettings, ChatMessage, LLMCompletionResponse, ToolDefinition } from './types';
import { PROVIDERS } from './providers/registry';
import { callOpenRouter } from './providers/openrouter';
import { callGemini } from './providers/gemini';
import { callAnthropic } from './providers/anthropic';
import { callOpenAICompatible } from './providers/openai-compatible';

export async function executeLLMCall(
  settings: AllSettings,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onStatusNotice?: (msg: string) => void
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
      return callOpenRouter(apiKey, model, messages, tools, temperature, onStatusNotice);

    case 'google':
      return callGemini(apiKey, model, messages, tools, temperature, onStatusNotice);

    case 'anthropic':
      return callAnthropic(apiKey, model, messages, tools, temperature, onStatusNotice);

    case 'openai':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.openai.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'OpenAI',
        onStatusNotice,
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
        onStatusNotice,
      });

    case 'alibaba':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.alibaba.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'Alibaba Qwen',
        onStatusNotice,
      });

    case 'xai':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.xai.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'xAI',
        onStatusNotice,
      });

    case 'zai':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.zai.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'Z.ai',
        onStatusNotice,
      });

    case 'mistral':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.mistral.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'Mistral',
        onStatusNotice,
      });

    case 'demonroute':
      return callOpenAICompatible({
        apiKey,
        baseUrl: providerConfig.baseUrl || PROVIDERS.demonroute.defaultBaseUrl!,
        model,
        messages,
        tools,
        temperature,
        providerName: 'DemonRoute',
        onStatusNotice,
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
        onStatusNotice,
      });

    default:
      throw new Error(`Unsupported provider: ${providerId}`);
  }
}
