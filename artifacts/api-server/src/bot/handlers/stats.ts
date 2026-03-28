import { Telegraf, Context } from "telegraf";
import { getOrCreateUser, getUserStats, getLeaderboard, getUserRecentBets } from "../db.js";
import { profileMessage, leaderboardMessage, formatBalance } from "../messages.js";
import { mainMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { GAMES, GameType, DAILY_BONUS } from "../config.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const dailyCooldowns = new Map<number, number>();

export function registerStatsHandlers(bot: Telegraf<Context>) {
  bot.command("stats", async (ctx) => {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx.from.id, { username: ctx.from.username, firstName: ctx.from.first_name });
    const stats = await getUserStats(ctx.from.id);
    if (!stats) return;

    const recentBets = await getUserRecentBets(ctx.from.id, 3);
    let recentText = "";
    if (recentBets.length > 0) {
      recentText = "\n\n*Recent Bets:*\n" + recentBets.map(b => {
        const game = GAMES[b.gameType as GameType];
        const won = b.winnerId === ctx.from!.id;
        const result = b.status === "completed" ? (won ? "✅ Won" : "❌ Lost") : `⏳ ${b.status}`;
        return `${game.emoji} ${game.name} — ${formatBalance(b.amount)} — ${result}`;
      }).join("\n");
    }

    await ctx.reply(profileMessage(stats, stats.rank) + recentText, {
      parse_mode: "Markdown",
      ...backToMenuKeyboard(),
    });
  });

  bot.action("stats", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const stats = await getUserStats(ctx.from.id);
    if (!stats) return;

    const recentBets = await getUserRecentBets(ctx.from.id, 3);
    let recentText = "";
    if (recentBets.length > 0) {
      recentText = "\n\n*Recent Bets:*\n" + recentBets.map(b => {
        const game = GAMES[b.gameType as GameType];
        const won = b.winnerId === ctx.from!.id;
        const result = b.status === "completed" ? (won ? "✅ Won" : "❌ Lost") : `⏳ ${b.status}`;
        return `${game.emoji} ${game.name} — ${formatBalance(b.amount)} — ${result}`;
      }).join("\n");
    }

    await ctx.editMessageText(profileMessage(stats, stats.rank) + recentText, {
      parse_mode: "Markdown",
      ...backToMenuKeyboard(),
    });
  });

  bot.command("leaderboard", async (ctx) => {
    const users = await getLeaderboard(10);
    await ctx.reply(leaderboardMessage(users), {
      parse_mode: "Markdown",
      ...backToMenuKeyboard(),
    });
  });

  bot.action("leaderboard", async (ctx) => {
    await ctx.answerCbQuery();
    const users = await getLeaderboard(10);
    await ctx.editMessageText(leaderboardMessage(users), {
      parse_mode: "Markdown",
      ...backToMenuKeyboard(),
    });
  });

  bot.command("daily", async (ctx) => {
    if (!ctx.from) return;
    await handleDaily(ctx);
  });

  bot.action("daily", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    await handleDailyAction(ctx);
  });
}

async function handleDaily(ctx: Context) {
  if (!ctx.from) return;
  const userId = ctx.from.id;

  const lastClaim = dailyCooldowns.get(userId);
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  if (lastClaim && now - lastClaim < cooldown) {
    const remaining = cooldown - (now - lastClaim);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return ctx.reply(
      `⏰ *Daily Bonus Not Ready*\n\nCome back in *${hours}h ${minutes}m* for your next bonus!`,
      { parse_mode: "Markdown" }
    );
  }

  const user = await getOrCreateUser(userId, { username: ctx.from.username, firstName: ctx.from.first_name });
  if (user.isBanned) return ctx.reply("🚫 You are banned.");

  const newBalance = parseFloat(user.balance as string) + DAILY_BONUS;
  await db.update(usersTable).set({ balance: newBalance.toString() }).where(eq(usersTable.telegramId, userId));
  dailyCooldowns.set(userId, now);

  await ctx.reply(
    `🎁 *Daily Bonus Claimed!*\n\n+${formatBalance(DAILY_BONUS)} added to your wallet!\n💰 New Balance: ${formatBalance(newBalance)}\n\nCome back tomorrow for more! 🎰`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
}

async function handleDailyAction(ctx: Context) {
  if (!ctx.from) return;
  const userId = ctx.from.id;

  const lastClaim = dailyCooldowns.get(userId);
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  if (lastClaim && now - lastClaim < cooldown) {
    const remaining = cooldown - (now - lastClaim);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return ctx.editMessageText(
      `⏰ *Daily Bonus Not Ready*\n\nCome back in *${hours}h ${minutes}m* for your next bonus!`,
      { parse_mode: "Markdown", ...mainMenuKeyboard() }
    );
  }

  const user = await getOrCreateUser(userId, { username: ctx.from.username, firstName: ctx.from.first_name });
  if (user.isBanned) return;

  const newBalance = parseFloat(user.balance as string) + DAILY_BONUS;
  await db.update(usersTable).set({ balance: newBalance.toString() }).where(eq(usersTable.telegramId, userId));
  dailyCooldowns.set(userId, now);

  await ctx.editMessageText(
    `🎁 *Daily Bonus Claimed!*\n\n+${formatBalance(DAILY_BONUS)} added to your wallet!\n💰 New Balance: ${formatBalance(newBalance)}\n\nCome back tomorrow for more! 🎰`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
}
