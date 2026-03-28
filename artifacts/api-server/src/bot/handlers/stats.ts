import { Telegraf, Context } from "telegraf";
import { getOrCreateUser, getUserStats, getLeaderboard, getUserRecentBets } from "../db.js";
import { profileMessage, leaderboardMessage, formatBalance } from "../messages.js";
import { mainMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { GAMES, GameType, DAILY_BONUS } from "../config.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { esc } from "../escape.js";

const dailyCooldowns = new Map<number, number>();

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
    return `${game.emoji} ${game.name} — ${formatBalance(b.amount)} — ${result}`;
  }).join("\n");
}

export function registerStatsHandlers(bot: Telegraf<Context>) {
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

  // Stats button — only the owner
  bot.action(/^stats_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /stats to view your own stats.", { show_alert: true });
    }
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

  bot.command("leaderboard", async (ctx) => {
    const users = await getLeaderboard(10);
    await ctx.reply(leaderboardMessage(users), {
      parse_mode: "MarkdownV2",
      ...backToMenuKeyboard(ctx.from?.id ?? 0),
    });
  });

  // Leaderboard button — owner only
  bot.action(/^leaderboard_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /leaderboard to view the rankings.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    const users = await getLeaderboard(10);
    await safeEdit(ctx, leaderboardMessage(users), {
      parse_mode: "MarkdownV2",
      ...backToMenuKeyboard(ctx.from.id),
    });
  });

  bot.command("daily", async (ctx) => {
    if (!ctx.from) return;
    await handleDaily(ctx, ctx.from.id, false);
  });

  // Daily button — owner only
  bot.action(/^daily_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /daily to claim your own bonus.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    await handleDaily(ctx, ctx.from.id, true);
  });
}

async function handleDaily(ctx: Context, userId: number, editMode: boolean) {
  const lastClaim = dailyCooldowns.get(userId);
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  if (lastClaim && now - lastClaim < cooldown) {
    const remaining = cooldown - (now - lastClaim);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const text = `⏰ *Daily Bonus Not Ready*\n\nCome back in *${hours}h ${minutes}m* for your next bonus\\!`;
    if (editMode) {
      try {
        await ctx.editMessageText(text, {
          parse_mode: "MarkdownV2",
          ...mainMenuKeyboard(userId),
        });
      } catch {}
    } else {
      await ctx.reply(text, { parse_mode: "MarkdownV2" });
    }
    return;
  }

  const user = await getOrCreateUser(userId, {});
  if (user.isBanned) return ctx.reply("🚫 You are banned.");

  const newBalance = parseFloat(user.balance as string) + DAILY_BONUS;
  await db.update(usersTable).set({ balance: newBalance.toString() }).where(eq(usersTable.telegramId, userId));
  dailyCooldowns.set(userId, now);

  const text = `🎁 *Daily Bonus Claimed\\!*\n\n\\+${formatBalance(DAILY_BONUS)} added to your wallet\\!\n💰 New Balance: ${formatBalance(newBalance)}\n\nCome back tomorrow for more\\! 🎰`;

  if (editMode) {
    try {
      await ctx.editMessageText(text, {
        parse_mode: "MarkdownV2",
        ...mainMenuKeyboard(userId),
      });
    } catch {}
  } else {
    await ctx.reply(text, {
      parse_mode: "MarkdownV2",
      ...mainMenuKeyboard(userId),
    });
  }
}
