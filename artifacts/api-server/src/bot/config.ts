export const GAMES = {
  // ── Telegram dice games ────────────────────────────────
  dice: {
    emoji: "🎲",
    name: "Dice",
    description: "Roll the dice — highest number wins!",
    minScore: 1,
    maxScore: 6,
    telegramEmoji: "🎲",
    isDice: true,
  },
  darts: {
    emoji: "🎯",
    name: "Darts",
    description: "Throw darts — bullseye (6) wins!",
    minScore: 1,
    maxScore: 6,
    telegramEmoji: "🎯",
    isDice: true,
  },
  football: {
    emoji: "⚽",
    name: "Football",
    description: "Kick the ball — highest score wins!",
    minScore: 0,
    maxScore: 5,
    telegramEmoji: "⚽",
    isDice: true,
  },
  bowling: {
    emoji: "🎳",
    name: "Bowling",
    description: "Bowl the ball — strike (6) wins!",
    minScore: 0,
    maxScore: 6,
    telegramEmoji: "🎳",
    isDice: true,
  },
  basketball: {
    emoji: "🏀",
    name: "Basketball",
    description: "Shoot the hoop — swish (5) wins!",
    minScore: 0,
    maxScore: 5,
    telegramEmoji: "🏀",
    isDice: true,
  },
  slots: {
    emoji: "🎰",
    name: "Slots",
    description: "Spin the slot machine — highest spin value wins! Lucky 64 = jackpot!",
    minScore: 1,
    maxScore: 64,
    telegramEmoji: "🎰",
    isDice: true,
  },
  // ── Instant / choice games ─────────────────────────────
  coinflip: {
    emoji: "🪙",
    name: "Coin Flip",
    description: "Pick Heads or Tails — bot flips instantly when challenger accepts!",
    minScore: 0,
    maxScore: 1,
    telegramEmoji: "",
    isDice: false,
  },
  rps: {
    emoji: "🤜",
    name: "Rock Paper Scissors",
    description: "Pick Rock, Paper, or Scissors — beat your opponent! Classic 3-way showdown.",
    minScore: 0,
    maxScore: 1,
    telegramEmoji: "",
    isDice: false,
  },
} as const;

export type GameType = keyof typeof GAMES;

// Dice-based games only (the subset that uses Telegram dice emoji)
export const DICE_GAMES: GameType[] = ["dice", "darts", "football", "bowling", "basketball", "slots"];

// Mapping from Telegram dice emoji → gameType
export const EMOJI_TO_GAME: Record<string, GameType> = {
  "🎲": "dice",
  "🎯": "darts",
  "⚽": "football",
  "🎳": "bowling",
  "🏀": "basketball",
  "🎰": "slots",
};

export const BET_AMOUNTS = [50, 100, 250, 500, 1000, 2500, 5000];

// ── Payment rates ─────────────────────────────────────────────────────────────
export const COINS_PER_STAR = 500;   // 1 ★ = 500 coins (deposit)
export const MIN_DEPOSIT_STARS = 1;

export const WITHDRAW_TIERS = [
  {
    coins: 10_000,
    stars: 15,
    gifts: ["💝 Heart Gift", "🧸 Teddy Bear"],
    label: "💝 Heart Gift / 🧸 Teddy Bear",
  },
  {
    coins: 25_000,
    stars: 25,
    gifts: ["🌹 Rose", "🎁 Gift Box"],
    label: "🌹 Rose / 🎁 Gift Box",
  },
] as const;
export const MIN_BET = 10;
export const MAX_BET = 100000;
export const STARTING_BALANCE = 1000;
export const BET_EXPIRY_MINUTES = 10;
export const DAILY_BONUS = 500;

export const ADMIN_IDS: number[] = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",").map(Number)
  : [];
