import { Telegraf, Context } from "telegraf";
import {
  getOrCreateUser, getUserStats, getLeaderboard, getUserRecentBets,
  claimWeeklyBonus, getUserActiveBets, cancelBetByCreator, awardXP,
} from "../db.js";
import { profileMessage, leaderboardMessage, formatBalance, mv2Num } from "../messages.js";
import { mainMenuKeyboard, backToMenuKeyboard, privateMenuKeyboard, myBetsKeyboard } from "../keyboards.js";
import { GAMES, GameType, DAILY_BONUS } from "../config.js";
import { db } from "@workspace/db";
import { usersTable, transactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { esc } from "../escape.js";

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

function buildRecentBetsText(recentBets: any[], userId: number): string {
  if (recentBets.length === 0) return "";
  return "\n\n*Recent Bets:*\n" + recentBets.map(b => {
    const game = GAMES[b.gameType as GameType];
    const won = b.winnerId === userId;
    const result = b.status === "completed" ? (won ? "✅ Won" : "❌ Lost") : `⏳ ${b.status}`;
    const amt = Math.abs(Number(b.amount)).toLocaleString("en-US", { maximumFractionDigits: 0 });
    return `${game.emoji} ${game.name} \\| 🪙 ${amt} \\| ${result}`;
  }).join("\n");
}

function nextDailyText(lastDailyAt: Date | null): { ready: boolean; text: string } {
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;
  if (!lastDailyAt) return { ready: true, text: "" };
  const lastMs = new Date(lastDailyAt).getTime();
  const nextMs = lastMs + cooldown;
  if (now >= nextMs) return { ready: true, text: "" };
  const remaining = nextMs - now;
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const nextStr = new Date(nextMs).toUTCString().replace(" GMT", " UTC");
  return {
    ready: false,
    text: `⏰ *Daily Bonus Not Ready*\n\n⌛ Next bonus in: *${hours}h ${minutes}m ${seconds}s*\n📅 Available at: _${esc(nextStr)}_\n\n_Bonuses reset exactly 24 hours after last claim_`,
  };
}

function nextWeeklyText(lastWeeklyAt: Date | null): { ready: boolean; text: string } {
  const now = Date.now();
  const cooldown = 7 * 24 * 60 * 60 * 1000;
  if (!lastWeeklyAt) return { ready: true, text: "" };
  const lastMs = new Date(lastWeeklyAt).getTime();
  const nextMs = lastMs + cooldown;
  if (now >= nextMs) return { ready: true, text: "" };
  const remaining = nextMs - now;
  const days  = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const mins  = Math.floor((remaining % 3600000) / 60000);
  const nextStr = new Date(nextMs).toUTCString().replace(" GMT", " UTC");
  return {
    ready: false,
    text: `📅 *Weekly Bonus Not Ready*\n\n⌛ Next bonus in: *${days}d ${hours}h ${mins}m*\n📅 Available at: _${esc(nextStr)}_\n\n_Weekly bonus resets 7 days after last claim_`,
  };
}

export function registerStatsHandlers(bot: Telegraf<Context>) {
  // ── /stats command ─────────────────────────────────────────────────────────
  bot.command("stats", async (ctx) => {
    if (!ctx.from) return;
    await getOrCreateUser(ctx.from.id, { username: ctx.from.username, firstName: ctx.from.first_name });
    const stats = await getUserStats(ctx.from.id);
    if (!stats) return;
    const recentBets = await getUserRecentBets(ctx.from.id, 3);
    const recentText = buildRecentBetsText(recentBets, ctx.from.id);
    await ctx.reply(profileMessage(stats, stats.rank) + recentText, {
      parse_mode: "MarkdownV2",
      ...backToMenuKeyboard(ctx.from.id),
    });
  });

  bot.action(/^stats_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /stats to view your own stats.", { show_alert: true });
    await ctx.answerCbQuery();
    const stats = await getUserStats(ctx.from.id);
    if (!stats) return;
    const recentBets = await getUserRecentBets(ctx.from.id, 3);
    const recentText = buildRecentBetsText(recentBets, ctx.from.id);
    await safeEdit(ctx, profileMessage(stats, stats.rank) + recentText, {
      parse_mode: "MarkdownV2",
      ...backToMenuKeyboard(ctx.from.id),
    });
  });

  // ── Leaderboard ────────────────────────────────────────────────────────────
  bot.command("leaderboard", async (ctx) => {
    const users = await getLeaderboard(10);
    await ctx.reply(leaderboardMessage(users), {
      parse_mode: "MarkdownV2",
      ...backToMenuKeyboard(ctx.from?.id ?? 0),
    });
  });

  bot.action(/^leaderboard_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /leaderboard to view the rankings.", { show_alert: true });
    await ctx.answerCbQuery();
    const users = await getLeaderboard(10);
    await safeEdit(ctx, leaderboardMessage(users), { parse_mode: "MarkdownV2", ...backToMenuKeyboard(ctx.from.id) });
  });

  // ── Daily Bonus ────────────────────────────────────────────────────────────
  bot.command("daily", async (ctx) => {
    if (!ctx.from) return;
    await handleDaily(ctx, ctx.from.id, false);
  });

  bot.action(/^daily_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /daily to claim your own bonus.", { show_alert: true });
    await ctx.answerCbQuery();
    await handleDaily(ctx, ctx.from.id, true);
  });

  // ── Weekly Bonus ───────────────────────────────────────────────────────────
  bot.command("weekly", async (ctx) => {
    if (!ctx.from) return;
    await handleWeekly(ctx, ctx.from.id, false);
  });

  bot.action(/^weekly_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /weekly to claim your own bonus.", { show_alert: true });
    await ctx.answerCbQuery();
    await handleWeekly(ctx, ctx.from.id, true);
  });

  // ── My Active Bets ─────────────────────────────────────────────────────────
  bot.command("mybets", async (ctx) => {
    if (!ctx.from) return;
    await handleMyBets(ctx, ctx.from.id, false);
  });

  bot.action(/^my_bets_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /mybets to see your own bets.", { show_alert: true });
    await ctx.answerCbQuery();
    await handleMyBets(ctx, ctx.from.id, true);
  });

  // Cancel my bet
  bot.action(/^cancel_my_bet_(\d+)_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const betId = parseInt(ctx.match[1]);
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your bet.", { show_alert: true });
    await ctx.answerCbQuery("Cancelling…");

    const result = await cancelBetByCreator(betId, ctx.from.id);
    if (!result.ok) {
      return ctx.answerCbQuery(`❌ ${result.reason}`, { show_alert: true });
    }

    await ctx.answerCbQuery(`✅ Bet cancelled! 🪙${result.amount?.toLocaleString()} refunded.`);
    // Refresh the bets list
    await handleMyBets(ctx, ctx.from.id, true);
  });
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleDaily(ctx: Context, userId: number, editMode: boolean) {
  const user = await getOrCreateUser(userId, {});
  if (user.isBanned) return ctx.reply("🚫 You are banned.");

  const { ready, text: cooldownText } = nextDailyText((user as any).lastDailyAt);

  if (!ready) {
    const menuKb = ctx.chat?.type === "private" ? privateMenuKeyboard(userId) : mainMenuKeyboard(userId);
    if (editMode) {
      await safeEdit(ctx, cooldownText, { parse_mode: "MarkdownV2", ...menuKb });
    } else {
      await ctx.reply(cooldownText, { parse_mode: "MarkdownV2" });
    }
    return;
  }

  const newBalance = parseFloat(user.balance as string) + DAILY_BONUS;
  const now = new Date();

  await db.update(usersTable).set({
    balance: newBalance.toString(),
    lastDailyAt: now,
  } as any).where(eq(usersTable.telegramId, userId));

  await db.insert(transactionsTable).values({
    userId,
    amount: DAILY_BONUS.toString(),
    type: "daily_bonus",
    description: "Daily bonus claimed",
    balanceBefore: user.balance as string,
    balanceAfter: newBalance.toString(),
  });

  // Award XP for daily claim
  awardXP(userId, "daily").catch(() => {});

  const nextClaimTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextStr = nextClaimTime.toUTCString().replace(" GMT", " UTC");
  const text = `🎁 *Daily Bonus Claimed\\!*\n\n\\+${mv2Num(DAILY_BONUS)} added to your wallet\\!\n💰 New Balance: ${mv2Num(newBalance)}\n\n⏰ Next bonus: _${esc(nextStr)}_\n\n_Come back in exactly 24 hours\\!_ 🎰`;

  const kb = ctx.chat?.type === "private" ? privateMenuKeyboard(userId) : mainMenuKeyboard(userId);
  if (editMode) {
    await safeEdit(ctx, text, { parse_mode: "MarkdownV2", ...kb });
  } else {
    await ctx.reply(text, { parse_mode: "MarkdownV2", ...kb });
  }
}

async function handleWeekly(ctx: Context, userId: number, editMode: boolean) {
  const user = await getOrCreateUser(userId, {});
  if (user.isBanned) return ctx.reply("🚫 You are banned.");

  const result = await claimWeeklyBonus(userId);
  const kb = ctx.chat?.type === "private" ? privateMenuKeyboard(userId) : mainMenuKeyboard(userId);

  if (!result.ok) {
    const nextStr = result.nextAt!.toUTCString().replace(" GMT", " UTC");
    const remaining = result.nextAt!.getTime() - Date.now();
    const days  = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const mins  = Math.floor((remaining % 3600000) / 60000);
    const text = `📅 *Weekly Bonus Not Ready*\n\n⌛ Next bonus in: *${days}d ${hours}h ${mins}m*\n📅 Available at: _${esc(nextStr)}_\n\n_Weekly bonus resets 7 days after last claim_`;
    if (editMode) {
      await safeEdit(ctx, text, { parse_mode: "MarkdownV2", ...kb });
    } else {
      await ctx.reply(text, { parse_mode: "MarkdownV2" });
    }
    return;
  }

  // Award weekly XP
  awardXP(userId, "weekly").catch(() => {});

  const freshUser = await getOrCreateUser(userId, {});
  const nextClaimTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const nextStr = nextClaimTime.toUTCString().replace(" GMT", " UTC");
  const text = `🗓 *Weekly Bonus Claimed\\!*\n\n\\+${mv2Num(result.coins!)} added to your wallet\\!\n💰 New Balance: ${mv2Num(freshUser.balance)}\n\n⏰ Next weekly bonus: _${esc(nextStr)}_\n\n_A fresh bonus every 7 days\\!_ 🎰`;

  if (editMode) {
    await safeEdit(ctx, text, { parse_mode: "MarkdownV2", ...kb });
  } else {
    await ctx.reply(text, { parse_mode: "MarkdownV2", ...kb });
  }
}

async function handleMyBets(ctx: Context, userId: number, editMode: boolean) {
  const bets = await getUserActiveBets(userId);
  const kb = myBetsKeyboard(bets, userId);

  const header = bets.length === 0
    ? `📋 *My Active Bets*\n\n_You have no active bets right now\\._\n\nCreate bets in your group chat\\!`
    : `📋 *My Active Bets* \\(${bets.length}\\)\n\n_Pending bets can be cancelled for a full refund\\._\n_Active bets \\(opponent joined\\) cannot be cancelled\\._`;

  if (editMode) {
    await safeEdit(ctx, header, { parse_mode: "MarkdownV2", ...kb });
  } else {
    await ctx.reply(header, { parse_mode: "MarkdownV2", ...kb });
  }
}
