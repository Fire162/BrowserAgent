/**
 * Model Token Cost Estimator
 */

export function estimateCostUSD(
  modelId: string,
  promptTokens = 0,
  completionTokens = 0,
  reportedCost?: number,
  cachedTokens = 0
): number {
  // 1. If provider explicitly reported a cost (including 0 for free tier models)
  if (typeof reportedCost === 'number' && reportedCost >= 0) {
    return reportedCost;
  }

  const modelLower = (modelId || '').toLowerCase();

  // 2. Explicit free models (e.g. openrouter/free, :free suffix, free tier)
  if (
    modelLower === 'openrouter/free' ||
    modelLower.endsWith(':free') ||
    modelLower.includes('/free')
  ) {
    return 0;
  }

  // Check if model belongs to the budget / lightweight tier
  const isBudget =
    modelLower.includes('flash') ||
    modelLower.includes('luna') ||
    modelLower.includes('haiku') ||
    modelLower.includes('build') ||
    modelLower.includes('ministral') ||
    modelLower.includes('mini') ||
    modelLower.includes('fast');

  // Rates per 1,000,000 tokens (USD)
  // Budget tier: ~$0.15 / 1M input, ~$0.60 / 1M output
  // Frontier tier: ~$2.50 / 1M input, ~$10.00 / 1M output
  const inputPricePerM = isBudget ? 0.15 : 2.50;
  const outputPricePerM = isBudget ? 0.60 : 10.00;
  // Cached input tokens receive ~90% prompt cache discount across Anthropic, DeepSeek, and OpenAI
  const cachedPricePerM = inputPricePerM * 0.10;

  const uncachedPromptTokens = Math.max(0, promptTokens - cachedTokens);
  const cost =
    (uncachedPromptTokens / 1_000_000) * inputPricePerM +
    (cachedTokens / 1_000_000) * cachedPricePerM +
    (completionTokens / 1_000_000) * outputPricePerM;

  return Math.round(cost * 100000) / 100000;
}
