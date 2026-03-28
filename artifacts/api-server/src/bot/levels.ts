// XP required to advance FROM each level (index 0 = lvl 1→2, index 1 = lvl 2→3, …)
const XP_PER_LEVEL = Array.from({ length: 99 }, (_, i) =>
  Math.floor(100 * Math.pow(i + 1, 1.5))
);

export const MAX_LEVEL = 100;

export function getLevel(xp: number): number {
  let level = 1;
  let total = 0;
  for (let i = 0; i < XP_PER_LEVEL.length; i++) {
    total += XP_PER_LEVEL[i];
    if (xp < total) return level;
    level++;
  }
  return MAX_LEVEL;
}

export function levelProgress(xp: number): { level: number; current: number; needed: number; pct: number } {
  let level = 1;
  let total = 0;
  for (let i = 0; i < XP_PER_LEVEL.length; i++) {
    const needed = XP_PER_LEVEL[i];
    if (xp < total + needed) {
      return { level, current: xp - total, needed, pct: Math.floor(((xp - total) / needed) * 100) };
    }
    total += needed;
    level++;
  }
  return { level: MAX_LEVEL, current: 0, needed: 0, pct: 100 };
}

export function levelBadge(level: number): string {
  if (level >= 51) return "👑";
  if (level >= 31) return "💎";
  if (level >= 21) return "🥇";
  if (level >= 11) return "🥈";
  if (level >= 6)  return "🥉";
  return "🌱";
}

export function levelUpReward(level: number): number {
  if (level >= 51) return 10_000;
  if (level >= 31) return 5_000;
  if (level >= 21) return 3_500;
  if (level >= 11) return 2_000;
  if (level >= 6)  return 1_000;
  return 500;
}

export const XP_REWARDS = {
  bet_created: 15,
  win:  50,
  loss: 10,
  tie:  20,
  daily: 25,
  weekly: 75,
  referral: 100,
} as const;

export type XPEvent = keyof typeof XP_REWARDS;
