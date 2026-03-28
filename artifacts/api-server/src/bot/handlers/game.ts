import { Telegraf, Context } from "telegraf";
import { Message } from "telegraf/types";
import { getUserByTelegramId, getBet, updateBetStatus, updateBalance, getActiveBets } from "../db.js";
import { betResultMessage, formatBalance } from "../messages.js";
import { GAMES, GameType } from "../config.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

export function registerGameHandlers(bot: Telegraf<Context>) {
  // Handle dice/game emoji messages
  bot.on("message", async (ctx, next) => {
    const msg = ctx.message as Message.DiceMessage;
    if (!msg.dice || !ctx.from || !ctx.chat) return next();

    const emoji = msg.dice.emoji;
    const score = msg.dice.value;

    // Map emoji to game type
    const emojiToGame: Record<string, GameType> = {
      "🎲": "dice",
      "🎯": "darts",
      "⚽": "football",
      "🎳": "bowling",
      "🏀": "basketball",
    };

    const gameKey = emojiToGame[emoji];
    if (!gameKey) return next();

    // Find an active bet in this chat where this player is involved
    const activeBets = await getActiveBets(ctx.chat.id);
    const playerBet = activeBets.find(b =>
      b.status === "active" &&
      b.gameType === gameKey &&
      (b.creatorId === ctx.from!.id || b.challengerId === ctx.from!.id)
    );

    if (!playerBet) return next();

    const betId = playerBet.id;
    const isCreator = playerBet.creatorId === ctx.from.id;
    const isChallenger = playerBet.challengerId === ctx.from.id;

    // Check if already played
    if (isCreator && playerBet.creatorScore !== null) {
      return ctx.reply("⚠️ You already rolled for this bet!", { reply_to_message_id: msg.message_id });
    }
    if (isChallenger && playerBet.challengerScore !== null) {
      return ctx.reply("⚠️ You already rolled for this bet!", { reply_to_message_id: msg.message_id });
    }

    // Record the score
    if (isCreator) {
      await updateBetStatus(betId, { creatorScore: score, creatorDiceMessageId: msg.message_id });
    } else {
      await updateBetStatus(betId, { challengerScore: score, challengerDiceMessageId: msg.message_id });
    }

    const updatedBet = await getBet(betId);
    if (!updatedBet) return;

    // If both have played, determine winner
    if (updatedBet.creatorScore !== null && updatedBet.challengerScore !== null) {
      const creator = await getUserByTelegramId(updatedBet.creatorId);
      const challenger = updatedBet.challengerId ? await getUserByTelegramId(updatedBet.challengerId) : null;

      const creatorName = creator?.username ? `@${creator.username}` : (creator?.firstName || "Player 1");
      const challengerName = challenger?.username ? `@${challenger.username}` : (challenger?.firstName || "Player 2");

      const amount = parseFloat(updatedBet.amount as string);
      const pot = amount * 2;

      let winnerId: number | null = null;
      let winnerName: string | null = null;

      if (updatedBet.creatorScore > updatedBet.challengerScore) {
        winnerId = updatedBet.creatorId;
        winnerName = creatorName;
      } else if (updatedBet.challengerScore > updatedBet.creatorScore && updatedBet.challengerId) {
        winnerId = updatedBet.challengerId;
        winnerName = challengerName;
      }

      await updateBetStatus(betId, {
        status: "completed",
        winnerId: winnerId || undefined,
        completedAt: new Date(),
      });

      if (winnerId) {
        // Winner gets pot
        await updateBalance(winnerId, pot, "bet_win", `Won bet #${betId}`, betId);

        // Update stats
        const loserId = winnerId === updatedBet.creatorId ? updatedBet.challengerId : updatedBet.creatorId;
        if (loserId) {
          await db.update(usersTable).set({
            totalWins: sql`total_wins + 1`,
            totalBets: sql`total_bets + 1`,
            totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}`,
            totalWon: sql`CAST(total_won AS DECIMAL) + ${pot}`,
          }).where(eq(usersTable.telegramId, winnerId));

          await db.update(usersTable).set({
            totalLosses: sql`total_losses + 1`,
            totalBets: sql`total_bets + 1`,
            totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}`,
          }).where(eq(usersTable.telegramId, loserId));
        }
      } else {
        // Tie — refund both
        await updateBalance(updatedBet.creatorId, amount, "refund", `Tie refund bet #${betId}`, betId);
        if (updatedBet.challengerId) {
          await updateBalance(updatedBet.challengerId, amount, "refund", `Tie refund bet #${betId}`, betId);
        }

        await db.update(usersTable).set({
          totalBets: sql`total_bets + 1`,
          totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}`,
        }).where(eq(usersTable.telegramId, updatedBet.creatorId));

        if (updatedBet.challengerId) {
          await db.update(usersTable).set({
            totalBets: sql`total_bets + 1`,
            totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}`,
          }).where(eq(usersTable.telegramId, updatedBet.challengerId));
        }
      }

      await ctx.reply(
        betResultMessage(updatedBet, creatorName, challengerName, winnerName, updatedBet.gameType as GameType),
        { parse_mode: "Markdown" }
      );
    } else {
      const waiting = isCreator ? challengerName(updatedBet) : "opponent";
      await ctx.reply(`✅ Score recorded: *${score}*\n\nWaiting for ${waiting} to roll...`, {
        parse_mode: "Markdown",
        reply_to_message_id: msg.message_id,
      });
    }

    return next();
  });
}

function challengerName(bet: any) {
  return "the challenger";
}
