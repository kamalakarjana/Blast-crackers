import defaultRewardTiers from "./rewardTiers.json";

export type RewardTier = {
  id: string;
  threshold: number;
  candleValue: number;
  crackerValue: number;
  bonusPack: string;
  enabled: boolean;
};

export const initialRewardTiers = defaultRewardTiers as RewardTier[];

export function isRewardTierList(value: unknown): value is RewardTier[] {
  if (!Array.isArray(value) || value.length > 30) return false;
  const ids = new Set<string>();
  const thresholds = new Set<number>();
  let previousThreshold = 0;

  for (const tier of value) {
    if (!tier || typeof tier !== "object") return false;
    const candidate = tier as Record<string, unknown>;
    if (
      typeof candidate.id !== "string"
      || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id)
      || ids.has(candidate.id)
      || typeof candidate.threshold !== "number"
      || !Number.isSafeInteger(candidate.threshold)
      || Number(candidate.threshold) <= previousThreshold
      || thresholds.has(Number(candidate.threshold))
      || typeof candidate.candleValue !== "number"
      || !Number.isSafeInteger(candidate.candleValue)
      || Number(candidate.candleValue) < 0
      || typeof candidate.crackerValue !== "number"
      || !Number.isSafeInteger(candidate.crackerValue)
      || Number(candidate.crackerValue) < 0
      || typeof candidate.bonusPack !== "string"
      || candidate.bonusPack.length > 100
      || typeof candidate.enabled !== "boolean"
    ) return false;
    ids.add(candidate.id);
    thresholds.add(Number(candidate.threshold));
    previousThreshold = Number(candidate.threshold);
  }
  return true;
}
