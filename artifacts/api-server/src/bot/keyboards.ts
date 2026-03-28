import { Markup } from "telegraf";
import { GAMES, BET_AMOUNTS, GameType } from "./config.js";
import type { Bet, User } from "@workspace/db/schema";

export function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🎮 Play Now", "play"),
      Markup.button.callback("📊 My Stats", "stats"),
    ],
    [
      Markup.button.callback("🏆 Leaderboard", "leaderboard"),
      Markup.button.callback("🎁 Daily Bonus", "daily"),
    ],
    [
      Markup.button.callback("🎲 Active Bets", "active_bets"),
      Markup.button.callback("❓ Help", "help"),
    ],
  ]);
}

export function gameSelectKeyboard() {
  const gameButtons = Object.entries(GAMES).map(([key, g]) => [
    Markup.button.callback(`${g.emoji} ${g.name}`, `game_${key}`),
  ]);

  return Markup.inlineKeyboard([
    ...gameButtons,
    [Markup.button.callback("❌ Cancel", "cancel")],
  ]);
}

export function betAmountKeyboard(gameKey: GameType) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  const amounts = BET_AMOUNTS;

  for (let i = 0; i < amounts.length; i += 3) {
    rows.push(
      amounts.slice(i, i + 3).map(a =>
        Markup.button.callback(`🪙 ${a.toLocaleString()}`, `bet_${gameKey}_${a}`)
      )
    );
  }

  rows.push([
    Markup.button.callback("✏️ Custom Amount", `bet_${gameKey}_custom`),
    Markup.button.callback("◀️ Back", "play"),
  ]);

  return Markup.inlineKeyboard(rows);
}

export function acceptBetKeyboard(betId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Accept Challenge!", `accept_${betId}`),
    ],
    [
      Markup.button.callback("❌ Cancel", `cancel_bet_${betId}`),
    ],
  ]);
}

export function activeBetsKeyboard(bets: Bet[], currentUserId: number) {
  if (bets.length === 0) {
    return Markup.inlineKeyboard([[Markup.button.callback("🎮 Create a Bet", "play")]]);
  }

  const buttons = bets.map(bet => {
    const game = GAMES[bet.gameType as GameType];
    const label = `${game.emoji} ${game.name} — 🪙${Number(bet.amount)} (${bet.status})`;
    return [Markup.button.callback(label, `view_bet_${bet.id}`)];
  });

  buttons.push([Markup.button.callback("🎮 Create New Bet", "play")]);
  return Markup.inlineKeyboard(buttons);
}

export function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("👥 User Management", "admin_users"),
      Markup.button.callback("📊 Bot Stats", "admin_stats"),
    ],
    [
      Markup.button.callback("🔍 Find User", "admin_find_user"),
      Markup.button.callback("💰 Adjust Balance", "admin_balance"),
    ],
    [
      Markup.button.callback("🚫 Ban User", "admin_ban"),
      Markup.button.callback("✅ Unban User", "admin_unban"),
    ],
    [
      Markup.button.callback("👑 Grant Admin", "admin_grant"),
      Markup.button.callback("🏆 Top Players", "admin_top"),
    ],
    [
      Markup.button.callback("📣 Broadcast", "admin_broadcast"),
      Markup.button.callback("🗑️ Cancel All Bets", "admin_cancel_bets"),
    ],
  ]);
}

export function userManagementKeyboard(user: User) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(user.isBanned ? "✅ Unban" : "🚫 Ban", user.isBanned ? `admin_do_unban_${user.telegramId}` : `admin_do_ban_${user.telegramId}`),
      Markup.button.callback(user.isAdmin ? "Remove Admin" : "Grant Admin", user.isAdmin ? `admin_revoke_${user.telegramId}` : `admin_grant_${user.telegramId}`),
    ],
    [
      Markup.button.callback("💰 Set Balance", `admin_set_bal_${user.telegramId}`),
      Markup.button.callback("💸 Add Balance", `admin_add_bal_${user.telegramId}`),
    ],
    [Markup.button.callback("◀️ Back to Admin", "admin_panel")],
  ]);
}

export function backToMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🏠 Main Menu", "start")],
  ]);
}

export function backToAdminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Admin", "admin_panel")],
  ]);
}
