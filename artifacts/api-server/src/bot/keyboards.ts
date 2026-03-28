import { Markup } from "telegraf";
import { GAMES, BET_AMOUNTS, GameType, COINS_PER_STAR } from "./config.js";
import type { Bet, User } from "@workspace/db/schema";

// Deposit quick-tiers shown on keyboard (stars)
const QUICK_DEPOSIT_STARS = [1, 10, 50, 100];

// ── Personal menus (userId encoded — owner only) ─────────────────────────────

export function mainMenuKeyboard(userId: number) {
  const botUsername = process.env.BOT_USERNAME || "AdsRewardGameBot";
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🎮 Create Bet",  `play_${userId}`),
      Markup.button.callback("📊 My Stats",    `stats_${userId}`),
    ],
    [
      Markup.button.callback("🏆 Leaderboard", `leaderboard_${userId}`),
      Markup.button.callback("🎁 Daily Bonus", `daily_${userId}`),
    ],
    [
      Markup.button.callback("💳 Deposit ⭐",  `deposit_menu_${userId}`),
      Markup.button.callback("📜 Wallet",      `wallet_${userId}`),
      Markup.button.callback("🎲 Active Bets", `active_bets_${userId}`),
    ],
    [
      Markup.button.callback("❓ Help", `help_${userId}`),
      Markup.button.url("➕ Add to Group", `https://t.me/${botUsername}?startgroup=true`),
    ],
    // Quick game rows — dice & classic
    [
      Markup.button.callback("🎲", `game_dice_${userId}`),
      Markup.button.callback("🎯", `game_darts_${userId}`),
      Markup.button.callback("⚽", `game_football_${userId}`),
      Markup.button.callback("🎳", `game_bowling_${userId}`),
      Markup.button.callback("🏀", `game_basketball_${userId}`),
    ],
    [
      Markup.button.callback("🎰", `game_slots_${userId}`),
      Markup.button.callback("🪙", `game_coinflip_${userId}`),
      Markup.button.callback("🤜", `game_rps_${userId}`),
    ],
    // Quick game rows — new games
    [
      Markup.button.callback("🃏", `game_highcard_${userId}`),
      Markup.button.callback("🀄", `game_baccarat_${userId}`),
      Markup.button.callback("🐉", `game_dragon_${userId}`),
      Markup.button.callback("⚡", `game_evenodd_${userId}`),
      Markup.button.callback("🔢", `game_lucky7_${userId}`),
      Markup.button.callback("🎡", `game_wheel_${userId}`),
    ],
  ]);
}

export function privateMenuKeyboard(userId: number) {
  const botUsername = process.env.BOT_USERNAME || "AdsRewardGameBot";
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("💳 Deposit ⭐",  `deposit_menu_${userId}`),
      Markup.button.callback("📜 Wallet",       `wallet_${userId}`),
      Markup.button.callback("📊 My Stats",     `stats_${userId}`),
    ],
    [
      Markup.button.callback("🏆 Leaderboard",  `leaderboard_${userId}`),
      Markup.button.callback("🎁 Daily Bonus",  `daily_${userId}`),
    ],
    [Markup.button.callback("❓ Help", `help_${userId}`)],
    [Markup.button.url("➕  ADD BOT TO YOUR GROUP  ➕", `https://t.me/${botUsername}?startgroup=true`)],
  ]);
}

export function gameSelectKeyboard(userId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🎲 Dice",       `game_dice_${userId}`),
      Markup.button.callback("🎯 Darts",      `game_darts_${userId}`),
    ],
    [
      Markup.button.callback("⚽ Football",   `game_football_${userId}`),
      Markup.button.callback("🎳 Bowling",    `game_bowling_${userId}`),
    ],
    [
      Markup.button.callback("🏀 Basketball", `game_basketball_${userId}`),
      Markup.button.callback("🎰 Slots",      `game_slots_${userId}`),
    ],
    [
      Markup.button.callback("🪙 Coin Flip",          `game_coinflip_${userId}`),
      Markup.button.callback("🤜 Rock Paper Scissors", `game_rps_${userId}`),
    ],
    [
      Markup.button.callback("🃏 High Card",    `game_highcard_${userId}`),
      Markup.button.callback("🀄 Baccarat",     `game_baccarat_${userId}`),
    ],
    [
      Markup.button.callback("🐉 Dragon Tiger", `game_dragon_${userId}`),
      Markup.button.callback("⚡ Even / Odd",   `game_evenodd_${userId}`),
    ],
    [
      Markup.button.callback("🔢 Lucky 7",      `game_lucky7_${userId}`),
      Markup.button.callback("🎡 Wheel Spin",   `game_wheel_${userId}`),
    ],
    [Markup.button.callback("❌ Cancel", `cancel_menu_${userId}`)],
  ]);
}

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
    Markup.button.callback("◀️ Back", `play_${userId}`),
  ]);
  return Markup.inlineKeyboard(rows);
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
    const label = `${game.emoji} ${game.name} — 🪙${Number(bet.amount)} (${bet.status})`;
    return [Markup.button.callback(label, `view_bet_${bet.id}`)];
  });
  buttons.push([Markup.button.callback("🎮 Create New Bet", `play_${userId}`)]);
  return Markup.inlineKeyboard(buttons);
}

export function rematchKeyboard(gameKey: GameType, amount: number, userId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`🔄 Rematch (🪙${amount.toLocaleString()})`, `rematch_${gameKey}_${amount}_${userId}`)],
    [Markup.button.callback("🎮 New Game", `play_${userId}`)],
  ]);
}

export function backToMenuKeyboard(userId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🏠 Main Menu", `menu_${userId}`)],
  ]);
}

// ── Deposit keyboard ──────────────────────────────────────────────────────────

export function depositMenuKeyboard(userId: number) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = QUICK_DEPOSIT_STARS.map(s => [
    Markup.button.callback(
      `⭐ ${s} Star${s > 1 ? "s" : ""} → 🪙 ${(s * COINS_PER_STAR).toLocaleString()} coins`,
      `deposit_${s}stars_${userId}`
    ),
  ]);
  rows.push([Markup.button.callback("✏️ Custom Amount", `deposit_custom_${userId}`)]);
  rows.push([Markup.button.callback("🏠 Main Menu", `menu_${userId}`)]);
  return Markup.inlineKeyboard(rows);
}

// ── Admin keyboards ───────────────────────────────────────────────────────────

export function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("👥 User Management", "admin_users"),
      Markup.button.callback("📊 Bot Stats",        "admin_stats"),
    ],
    [
      Markup.button.callback("🔍 Find User",      "admin_find_user"),
      Markup.button.callback("💰 Adjust Balance", "admin_balance"),
    ],
    [
      Markup.button.callback("🚫 Ban User",    "admin_ban"),
      Markup.button.callback("✅ Unban User",  "admin_unban"),
    ],
    [
      Markup.button.callback("👑 Grant Admin", "admin_grant"),
      Markup.button.callback("🏆 Top Players", "admin_top"),
    ],
    [
      Markup.button.callback("📣 Broadcast",        "admin_broadcast"),
      Markup.button.callback("🗑️ Cancel Old Bets",  "admin_cancel_bets"),
    ],
  ]);
}

export function userManagementKeyboard(user: User) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        user.isBanned ? "✅ Unban" : "🚫 Ban",
        user.isBanned ? `admin_do_unban_${user.telegramId}` : `admin_do_ban_${user.telegramId}`
      ),
      Markup.button.callback(
        user.isAdmin ? "Remove Admin" : "Grant Admin",
        user.isAdmin ? `admin_revoke_${user.telegramId}` : `admin_grant_${user.telegramId}`
      ),
    ],
    [
      Markup.button.callback("💰 Set Balance", `admin_set_bal_${user.telegramId}`),
      Markup.button.callback("💸 Add Balance", `admin_add_bal_${user.telegramId}`),
    ],
    [Markup.button.callback("◀️ Back to Admin", "admin_panel")],
  ]);
}

export function backToAdminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Admin", "admin_panel")],
  ]);
}
