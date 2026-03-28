export const GAMES = {
  dice: {
    emoji: "🎲",
    name: "Dice",
    description: "Roll dice — highest number wins!",
    minScore: 1,
    maxScore: 6,
    telegramEmoji: "🎲",
  },
  darts: {
    emoji: "🎯",
    name: "Darts",
    description: "Throw darts — bullseye (6) wins!",
    minScore: 1,
    maxScore: 6,
    telegramEmoji: "🎯",
  },
  football: {
    emoji: "⚽",
    name: "Football",
    description: "Kick the ball — score or miss?",
    minScore: 0,
    maxScore: 5,
    telegramEmoji: "⚽",
  },
  bowling: {
    emoji: "🎳",
    name: "Bowling",
    description: "Bowl the ball — strike wins!",
    minScore: 0,
    maxScore: 6,
    telegramEmoji: "🎳",
  },
  basketball: {
    emoji: "🏀",
    name: "Basketball",
    description: "Shoot the hoop — swish wins!",
    minScore: 0,
    maxScore: 5,
    telegramEmoji: "🏀",
  },
} as const;

export type GameType = keyof typeof GAMES;

export const BET_AMOUNTS = [50, 100, 250, 500, 1000, 2500, 5000];
export const MIN_BET = 10;
export const MAX_BET = 100000;
export const STARTING_BALANCE = 1000;
export const BET_EXPIRY_MINUTES = 10;
export const DAILY_BONUS = 500;

export const ADMIN_IDS: number[] = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",").map(Number)
  : [];
