export type ProviderId = 
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'deepseek'
  | 'alibaba'
  | 'xai'
  | 'zai'
  | 'mistral'
  | 'openrouter'
  | 'custom';

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  recommended?: boolean;
}

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  description: string;
  defaultBaseUrl?: string;
  defaultModel: string;
  models: ModelOption[];
  requiresApiKey: boolean;
  apiKeyHelpUrl: string;
}

export interface ProviderSettings {
  apiKey: string;
  baseUrl?: string;
  selectedModel: string;
  customModelId?: string;
}

export interface AllSettings {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
  agent: {
    maxSteps: number;
    showVisualLabels: boolean;
    autoScroll: boolean;
    temperature: number;
    systemPromptOverride?: string;
  };
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp?: number;
}

export interface LLMCompletionResponse {
  text: string;
  toolCalls?: ToolCall[];
  rawResponse?: any;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}
