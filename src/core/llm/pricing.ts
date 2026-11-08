/**
 * Model Token Cost Estimator
 */

export function estimateCostUSD(
  modelId: string,
  promptTokens = 0,
  completionTokens = 0,
  reportedCost?: number
): number {
  if (typeof reportedCost === 'number' && reportedCost > 0) {
    return reportedCost;
  }

  const modelLower = (modelId || '').toLowerCase();

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

  const cost = (promptTokens / 1_000_000) * inputPricePerM + (completionTokens / 1_000_000) * outputPricePerM;
  return Math.round(cost * 100000) / 100000;
}
