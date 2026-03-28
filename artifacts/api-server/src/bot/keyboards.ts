import { Markup } from "telegraf";
import { GAMES, BET_AMOUNTS, GameType, COINS_PER_STAR } from "./config.js";
import type { Bet, User } from "@workspace/db/schema";

const QUICK_DEPOSIT_STARS = [1, 10, 50, 100];

// ─────────────────────────────────────────────────────────────────────────────
// Main menus
// ─────────────────────────────────────────────────────────────────────────────

export function mainMenuKeyboard(userId: number) {
  const botUsername = process.env.BOT_USERNAME || "AdsRewardGameBot";
  return Markup.inlineKeyboard([
    // ── Core actions ────────────────────────────────────────────────────────
    [
      Markup.button.callback("🎮 Play",        `play_${userId}`),
      Markup.button.callback("📊 Stats",       `stats_${userId}`),
      Markup.button.callback("🏆 Leaderboard", `leaderboard_${userId}`),
    ],
    [
      Markup.button.callback("💳 Deposit ⭐",  `deposit_menu_${userId}`),
      Markup.button.callback("📜 Wallet",      `wallet_${userId}`),
      Markup.button.callback("🎁 Daily Bonus", `daily_${userId}`),
    ],
    [
      Markup.button.callback("🎲 Active Bets", `active_bets_${userId}`),
      Markup.button.callback("❓ Help",         `help_${userId}`),
      Markup.button.url("➕ Add Bot",           `https://t.me/${botUsername}?startgroup=true`),
    ],
    // ── Quick-play: Dice games ───────────────────────────────────────────
    [
      Markup.button.callback("🎲 Dice",   `game_dice_${userId}`),
      Markup.button.callback("🎯 Darts",  `game_darts_${userId}`),
      Markup.button.callback("⚽ Foot",   `game_football_${userId}`),
      Markup.button.callback("🎳 Bowl",   `game_bowling_${userId}`),
      Markup.button.callback("🏀 Bball",  `game_basketball_${userId}`),
      Markup.button.callback("🎰 Slots",  `game_slots_${userId}`),
    ],
    // ── Quick-play: Instant games ────────────────────────────────────────
    [
      Markup.button.callback("🪙 Flip",   `game_coinflip_${userId}`),
      Markup.button.callback("🤜 RPS",    `game_rps_${userId}`),
      Markup.button.callback("🃏 Card",   `game_highcard_${userId}`),
      Markup.button.callback("🀄 Bac",    `game_baccarat_${userId}`),
      Markup.button.callback("🐉 Drag",   `game_dragon_${userId}`),
    ],
    [
      Markup.button.callback("⚡ E/O",    `game_evenodd_${userId}`),
      Markup.button.callback("🔢 L7",     `game_lucky7_${userId}`),
      Markup.button.callback("🎡 Wheel",  `game_wheel_${userId}`),
    ],
  ]);
}

export function privateMenuKeyboard(userId: number) {
  const botUsername = process.env.BOT_USERNAME || "AdsRewardGameBot";
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("💳 Deposit Stars", `deposit_menu_${userId}`),
      Markup.button.callback("📜 Wallet",         `wallet_${userId}`),
    ],
    [
      Markup.button.callback("📊 My Stats",       `stats_${userId}`),
      Markup.button.callback("🏆 Leaderboard",    `leaderboard_${userId}`),
    ],
    [
      Markup.button.callback("🎁 Daily Bonus",    `daily_${userId}`),
      Markup.button.callback("❓ Help",            `help_${userId}`),
    ],
    [
      Markup.button.url("➕  Add Bot to Your Group  ➕", `https://t.me/${botUsername}?startgroup=true`),
    ],
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Game selection
// ─────────────────────────────────────────────────────────────────────────────

export function gameSelectKeyboard(userId: number) {
  return Markup.inlineKeyboard([
    // Section: Dice Games
    [Markup.button.callback("━━━ 🎲 DICE GAMES ━━━", `noop_${userId}`)],
    [
      Markup.button.callback("🎲 Dice",       `game_dice_${userId}`),
      Markup.button.callback("🎯 Darts",      `game_darts_${userId}`),
      Markup.button.callback("⚽ Football",   `game_football_${userId}`),
    ],
    [
      Markup.button.callback("🎳 Bowling",    `game_bowling_${userId}`),
      Markup.button.callback("🏀 Basketball", `game_basketball_${userId}`),
      Markup.button.callback("🎰 Slots",      `game_slots_${userId}`),
    ],
    // Section: Instant Games
    [Markup.button.callback("━━━ ⚡ INSTANT GAMES ━━━", `noop_${userId}`)],
    [
      Markup.button.callback("🪙 Coin Flip",     `game_coinflip_${userId}`),
      Markup.button.callback("🤜 RPS",            `game_rps_${userId}`),
      Markup.button.callback("🃏 High Card",      `game_highcard_${userId}`),
    ],
    [
      Markup.button.callback("🀄 Baccarat",       `game_baccarat_${userId}`),
      Markup.button.callback("🐉 Dragon Tiger",   `game_dragon_${userId}`),
      Markup.button.callback("⚡ Even / Odd",     `game_evenodd_${userId}`),
    ],
    [
      Markup.button.callback("🔢 Lucky 7",        `game_lucky7_${userId}`),
      Markup.button.callback("🎡 Wheel Spin",     `game_wheel_${userId}`),
    ],
    [Markup.button.callback("❌ Cancel", `cancel_menu_${userId}`)],
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Choice pickers
// ─────────────────────────────────────────────────────────────────────────────

export function baccaratPickKeyboard(userId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🎰 Player", `bacpick_player_${userId}`),
      Markup.button.callback("🏦 Banker", `bacpick_banker_${userId}`),
    ],
    [Markup.button.callback("◀️ Back", `play_${userId}`)],
  ]);
}

export function dragonPickKeyboard(userId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🐉 Dragon", `drpick_dragon_${userId}`),
      Markup.button.callback("🐯 Tiger",  `drpick_tiger_${userId}`),
    ],
    [Markup.button.callback("◀️ Back", `play_${userId}`)],
  ]);
}

export function evenoddPickKeyboard(userId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("2️⃣ Even", `eopick_even_${userId}`),
      Markup.button.callback("1️⃣ Odd",  `eopick_odd_${userId}`),
    ],
    [Markup.button.callback("◀️ Back", `play_${userId}`)],
  ]);
}

export function coinflipPickKeyboard(userId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🌕 Heads", `cfpick_heads_${userId}`),
      Markup.button.callback("🌑 Tails", `cfpick_tails_${userId}`),
    ],
    [Markup.button.callback("◀️ Back", `play_${userId}`)],
  ]);
}

export function rpsPickKeyboard(betId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🪨 Rock",     `rpspick_rock_${betId}`),
      Markup.button.callback("📄 Paper",    `rpspick_paper_${betId}`),
      Markup.button.callback("✂️ Scissors", `rpspick_scissors_${betId}`),
    ],
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bet flow
// ─────────────────────────────────────────────────────────────────────────────

export function betAmountKeyboard(gameKey: GameType, userId: number) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < BET_AMOUNTS.length; i += 3) {
    rows.push(
      BET_AMOUNTS.slice(i, i + 3).map(a =>
        Markup.button.callback(`🪙 ${a.toLocaleString()}`, `bet_${gameKey}_${a}_${userId}`)
      )
    );
  }
  rows.push([
    Markup.button.callback("✏️ Custom Amount", `betcustom_${gameKey}_${userId}`),
    Markup.button.callback("◀️ Back",          `play_${userId}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

export function acceptBetKeyboard(betId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Accept Challenge!", `accept_${betId}`)],
    [Markup.button.callback("❌ Cancel Bet",        `cancel_bet_${betId}`)],
  ]);
}

export function activeBetsKeyboard(bets: Bet[], userId: number) {
  if (bets.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("🎮 Create a Bet", `play_${userId}`)],
    ]);
  }
  const buttons = bets.map(bet => {
    const game = GAMES[bet.gameType as GameType];
    const label = `${game.emoji} ${game.name} — 🪙${Number(bet.amount).toLocaleString()} (${bet.status})`;
    return [Markup.button.callback(label, `view_bet_${bet.id}`)];
  });
  buttons.push([Markup.button.callback("🎮 Create New Bet", `play_${userId}`)]);
  return Markup.inlineKeyboard(buttons);
}

export function rematchKeyboard(gameKey: GameType, amount: number, userId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`🔄 Rematch — 🪙${amount.toLocaleString()}`, `rematch_${gameKey}_${amount}_${userId}`)],
    [
      Markup.button.callback("🎮 New Game",   `play_${userId}`),
      Markup.button.callback("🏠 Main Menu",  `menu_${userId}`),
    ],
  ]);
}

export function backToMenuKeyboard(userId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🏠 Main Menu",  `menu_${userId}`),
      Markup.button.callback("💳 Deposit ⭐", `deposit_menu_${userId}`),
    ],
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Deposit
// ─────────────────────────────────────────────────────────────────────────────

export function depositMenuKeyboard(userId: number) {
  const tiers = [
    { stars: 1,   coins: 500 },
    { stars: 10,  coins: 5_000 },
    { stars: 50,  coins: 25_000 },
    { stars: 100, coins: 50_000 },
  ];
  const rows: ReturnType<typeof Markup.button.callback>[][] = tiers.map(t => [
    Markup.button.callback(
      `⭐ ${t.stars} Star${t.stars > 1 ? "s" : ""}  →  🪙 ${t.coins.toLocaleString()} coins`,
      `deposit_${t.stars}stars_${userId}`
    ),
  ]);
  rows.push([Markup.button.callback("✏️ Custom Amount", `deposit_custom_${userId}`)]);
  rows.push([Markup.button.callback("🏠 Back to Menu",  `menu_${userId}`)]);
  return Markup.inlineKeyboard(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

export function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    // ── Overview ────────────────────────────────────────────────────────────
    [
      Markup.button.callback("📊 Statistics",    "admin_stats"),
      Markup.button.callback("🏆 Top Players",   "admin_top"),
    ],
    // ── Users ───────────────────────────────────────────────────────────────
    [
      Markup.button.callback("👥 All Users",     "admin_users"),
      Markup.button.callback("🔍 Find User",     "admin_find_user"),
    ],
    // ── Balance ─────────────────────────────────────────────────────────────
    [
      Markup.button.callback("💰 Add Coins",     "admin_add_coins"),
      Markup.button.callback("💸 Remove Coins",  "admin_remove_coins"),
    ],
    // ── Moderation ──────────────────────────────────────────────────────────
    [
      Markup.button.callback("🚫 Ban User",      "admin_ban"),
      Markup.button.callback("✅ Unban User",    "admin_unban"),
    ],
    // ── Payments ────────────────────────────────────────────────────────────
    [
      Markup.button.callback("⭐ Refund Stars",  "admin_refund_stars"),
      Markup.button.callback("👑 Grant Admin",   "admin_grant"),
    ],
    // ── Tools ───────────────────────────────────────────────────────────────
    [
      Markup.button.callback("📣 Broadcast",         "admin_broadcast"),
      Markup.button.callback("🗑️ Cancel Old Bets",   "admin_cancel_bets"),
    ],
  ]);
}

export function userManagementKeyboard(user: User) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        user.isBanned ? "✅ Unban User" : "🚫 Ban User",
        user.isBanned ? `admin_do_unban_${user.telegramId}` : `admin_do_ban_${user.telegramId}`
      ),
      Markup.button.callback(
        user.isAdmin ? "🔻 Remove Admin" : "👑 Grant Admin",
        user.isAdmin ? `admin_revoke_${user.telegramId}` : `admin_grant_${user.telegramId}`
      ),
    ],
    [
      Markup.button.callback("💰 Set Balance", `admin_set_bal_${user.telegramId}`),
      Markup.button.callback("💸 Add/Remove",  `admin_add_bal_${user.telegramId}`),
    ],
    [Markup.button.callback("◀️ Back to Admin Panel", "admin_panel")],
  ]);
}

export function backToAdminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Admin Panel", "admin_panel")],
  ]);
}
