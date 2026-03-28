import { Telegraf, Context } from "telegraf";
import {
  getOrCreateUser, getUserByTelegramId, createBet, getBet,
  updateBetStatus, updateBalance, updateStreaks, getActiveBets,
} from "../db.js";
import { betCreatedMessage, betActiveMessage, formatBalance } from "../messages.js";
import {
  gameSelectKeyboard, betAmountKeyboard, coinflipPickKeyboard,
  acceptBetKeyboard, activeBetsKeyboard, backToMenuKeyboard, rpsPickKeyboard,
} from "../keyboards.js";
import { GAMES, GameType, MIN_BET, MAX_BET } from "../config.js";
import { esc } from "../escape.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

const pendingCustomBets = new Map<number, { gameKey: GameType }>();
// For coinflip: track which amount the user chose before picking H/T
const pendingCoinflip = new Map<number, { amount: number }>();

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

/** Validate and create a quick-bet from a command, e.g. /dice 500 */
async function quickBet(ctx: Context, gameKey: GameType, rawAmount: string | undefined) {
  if (!ctx.from || !ctx.chat) return;

  const user = await getOrCreateUser(ctx.from.id, {
    username: ctx.from.username,
    firstName: ctx.from.first_name,
  });

  if (user.isBanned) return ctx.reply("🚫 You are banned from this casino.");

  const game = GAMES[gameKey];

  // Coin flip requires picking H/T first — show amount keyboard then H/T pick
  if (gameKey === "coinflip") {
    if (!rawAmount || rawAmount.trim() === "") {
      return ctx.reply(
        `${game.emoji} *Coin Flip — Pick Amount*\n\nUsage: \`/coinflip <amount>\`\n\nRange: ${formatBalance(MIN_BET)} — ${formatBalance(MAX_BET)}`,
        { parse_mode: "MarkdownV2", ...betAmountKeyboard(gameKey, ctx.from.id) }
      );
    }
    const amount = parseFloat(rawAmount.trim());
    if (isNaN(amount) || amount < MIN_BET || amount > MAX_BET) {
      return ctx.reply(`❌ Amount must be between ${formatBalance(MIN_BET)} and ${formatBalance(MAX_BET)}\\.`, { parse_mode: "MarkdownV2" });
    }
    if (parseFloat(user.balance as string) < amount) {
      return ctx.reply(`❌ Insufficient balance\\. You need ${formatBalance(amount)}\\.`, { parse_mode: "MarkdownV2" });
    }
    pendingCoinflip.set(ctx.from.id, { amount });
    return ctx.reply(`🪙 *Coin Flip — ${formatBalance(amount)}*\n\nWhich side do you pick?`, {
      parse_mode: "MarkdownV2",
      ...coinflipPickKeyboard(ctx.from.id),
    });
  }

  if (!rawAmount || rawAmount.trim() === "") {
    return ctx.reply(
      `${game.emoji} *${game.name} — Quick Bet*\n\nUsage: \`/${gameKey} <amount>\`\nRange: ${formatBalance(MIN_BET)} — ${formatBalance(MAX_BET)}`,
      { parse_mode: "MarkdownV2", ...betAmountKeyboard(gameKey, ctx.from.id) }
    );
  }

  const amount = parseFloat(rawAmount.trim());
  if (isNaN(amount) || amount < MIN_BET || amount > MAX_BET) {
    return ctx.reply(`❌ Amount must be between ${formatBalance(MIN_BET)} and ${formatBalance(MAX_BET)}\\.`, { parse_mode: "MarkdownV2" });
  }
  if (parseFloat(user.balance as string) < amount) {
    return ctx.reply(`❌ Insufficient balance\\. You need ${formatBalance(amount)} but have ${formatBalance(user.balance)}\\.`, { parse_mode: "MarkdownV2" });
  }

  const bet = await createBet(ctx.from.id, gameKey, amount, ctx.chat.id);
  const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
  await ctx.reply(betCreatedMessage(bet, creatorName, gameKey), {
    parse_mode: "MarkdownV2",
    ...acceptBetKeyboard(bet.id),
  });
}

export function registerPlayHandlers(bot: Telegraf<Context>) {
  // Full play menu
  bot.command("play", async (ctx) => {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx.from.id, { username: ctx.from.username, firstName: ctx.from.first_name });
    if (user.isBanned) return ctx.reply("🚫 You are banned from this casino.");
    await ctx.reply("🎮 *Choose your game:*", {
      parse_mode: "MarkdownV2",
      ...gameSelectKeyboard(ctx.from.id),
    });
  });

  // ── Quick Bet Shortcuts ──────────────────────────────────────────────────
  bot.command("dice",       ctx => quickBet(ctx, "dice",       ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("darts",      ctx => quickBet(ctx, "darts",      ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("football",   ctx => quickBet(ctx, "football",   ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("bowling",    ctx => quickBet(ctx, "bowling",    ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("basketball", ctx => quickBet(ctx, "basketball", ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("slots",      ctx => quickBet(ctx, "slots",      ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("coinflip",   ctx => quickBet(ctx, "coinflip",   ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("rps",        ctx => quickBet(ctx, "rps",        ctx.message.text.split(" ").slice(1).join(" ")));
  // ────────────────────────────────────────────────────────────────────────

  // play_{userId}
  bot.action(/^play_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    await ctx.answerCbQuery();
    await safeEdit(ctx, "🎮 *Choose your game:*", { parse_mode: "MarkdownV2", ...gameSelectKeyboard(ctx.from.id) });
  });

  // cancel_menu_{userId}
  bot.action(/^cancel_menu_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ This isn't your menu.", { show_alert: true });
    await ctx.answerCbQuery("Cancelled");
    try { await ctx.deleteMessage(); } catch {}
  });

  bot.command("bets", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const bets = await getActiveBets(ctx.chat.id);
    await ctx.reply("🎲 *Active Bets in This Chat:*", { parse_mode: "MarkdownV2", ...activeBetsKeyboard(bets, ctx.from.id) });
  });

  // active_bets_{userId}
  bot.action(/^active_bets_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /bets to see bets.", { show_alert: true });
    await ctx.answerCbQuery();
    const bets = await getActiveBets(ctx.chat.id);
    await safeEdit(ctx, "🎲 *Active Bets in This Chat:*", { parse_mode: "MarkdownV2", ...activeBetsKeyboard(bets, ctx.from.id) });
  });

  // Game selection: game_{gameKey}_{userId}
  bot.action(/^game_([a-z]+)_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const gameKey = ctx.match[1] as GameType;
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    if (!GAMES[gameKey]) return ctx.answerCbQuery("Invalid game");
    await ctx.answerCbQuery();
    const game = GAMES[gameKey];
    await safeEdit(ctx,
      `${game.emoji} *${game.name}*\n\n📖 ${esc(game.description)}\n\n💰 *Choose your bet amount:*`,
      { parse_mode: "MarkdownV2", ...betAmountKeyboard(gameKey, ctx.from.id) }
    );
  });

  // Preset amounts: bet_{gameKey}_{amount}_{userId}
  bot.action(/^bet_([a-z]+)_(\d+)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const gameKey = ctx.match[1] as GameType;
    const amount = parseInt(ctx.match[2]);
    const ownerId = parseInt(ctx.match[3]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    if (!GAMES[gameKey]) return;
    await ctx.answerCbQuery();

    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;
    if (parseFloat(user.balance as string) < amount) {
      return ctx.answerCbQuery(`❌ Need ${formatBalance(amount)} — you have ${formatBalance(user.balance)}`, { show_alert: true });
    }

    // Coinflip: store amount, show H/T picker instead
    if (gameKey === "coinflip") {
      pendingCoinflip.set(ctx.from.id, { amount });
      return safeEdit(ctx, `🪙 *Coin Flip — ${formatBalance(amount)}*\n\nWhich side do you pick?`, {
        parse_mode: "MarkdownV2",
        ...coinflipPickKeyboard(ctx.from.id),
      });
    }

    await doCreateBet(ctx, gameKey, amount);
  });

  // Coin flip side pick: cfpick_{side}_{userId}
  bot.action(/^cfpick_(heads|tails)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const side = ctx.match[1] as "heads" | "tails";
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your bet.", { show_alert: true });

    const pending = pendingCoinflip.get(ctx.from.id);
    if (!pending) return ctx.answerCbQuery("❌ Session expired, start over.", { show_alert: true });
    pendingCoinflip.delete(ctx.from.id);

    await ctx.answerCbQuery(`You picked ${side === "heads" ? "🌕 Heads" : "🌑 Tails"}`);

    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;
    if (parseFloat(user.balance as string) < pending.amount) {
      return safeEdit(ctx, `❌ Insufficient balance\\.`, { parse_mode: "MarkdownV2" });
    }

    const bet = await createBet(ctx.from.id, "coinflip", pending.amount, ctx.chat.id, undefined, side);
    const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
    await safeEdit(ctx, betCreatedMessage(bet, creatorName, "coinflip"), {
      parse_mode: "MarkdownV2",
      ...acceptBetKeyboard(bet.id),
    });
  });

  // Custom amount: betcustom_{gameKey}_{userId}
  bot.action(/^betcustom_([a-z]+)_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const gameKey = ctx.match[1] as GameType;
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    await ctx.answerCbQuery();
    pendingCustomBets.set(ctx.from.id, { gameKey });
    await safeEdit(ctx,
      `✏️ *Enter Custom Bet Amount*\n\nRange: ${formatBalance(MIN_BET)} — ${formatBalance(MAX_BET)}\n\nType the number below:`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // Accept bet — anyone except creator
  bot.action(/^accept_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const betId = parseInt(ctx.match[1]);
    const bet = await getBet(betId);

    if (!bet) return ctx.answerCbQuery("❌ Bet not found", { show_alert: true });
    if (bet.status !== "pending") return ctx.answerCbQuery("❌ Bet is no longer available", { show_alert: true });
    if (bet.creatorId === ctx.from.id) return ctx.answerCbQuery("❌ You can't accept your own bet!", { show_alert: true });

    const challenger = await getOrCreateUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
    if (challenger.isBanned) return ctx.answerCbQuery("🚫 You are banned.", { show_alert: true });

    const amount = parseFloat(bet.amount as string);
    if (parseFloat(challenger.balance as string) < amount) {
      return ctx.answerCbQuery(`❌ Need ${formatBalance(amount)} — you have ${formatBalance(challenger.balance)}`, { show_alert: true });
    }

    const creator = await getUserByTelegramId(bet.creatorId);
    if (!creator) return ctx.answerCbQuery("❌ Creator not found", { show_alert: true });

    await updateBalance(bet.creatorId, -amount, "bet_placed", `Bet #${betId}`, betId);
    await updateBalance(ctx.from.id, -amount, "bet_placed", `Bet #${betId}`, betId);
    await updateBetStatus(betId, { status: "active", challengerId: ctx.from.id });

    const gameKey = bet.gameType as GameType;
    const game = GAMES[gameKey];
    const creatorName = creator.username ? `@${creator.username}` : (creator.firstName || "Player 1");
    const challengerName = challenger.username ? `@${challenger.username}` : (challenger.firstName || "Player 2");

    // ── Coin Flip: resolve instantly ─────────────────────────────────
    if (gameKey === "coinflip") {
      const flip = Math.random() < 0.5 ? "heads" : "tails";
      const flipScore = flip === "heads" ? 1 : 0;
      const challengerSide = bet.creatorChoice === "heads" ? "tails" : "heads"; // challenger always gets opposite

      let winnerId: number | null = null;
      let winnerName: string | null = null;
      if (flip === bet.creatorChoice) {
        winnerId = bet.creatorId;
        winnerName = creatorName;
      } else {
        winnerId = ctx.from.id;
        winnerName = challengerName;
      }

      await updateBetStatus(betId, {
        status: "completed",
        challengerId: ctx.from.id,
        challengerChoice: challengerSide,
        creatorScore: flipScore,
        challengerScore: 1 - flipScore,
        winnerId,
        completedAt: new Date(),
      });

      if (winnerId) {
        await updateBalance(winnerId, amount * 2, "bet_win", `Won bet #${betId}`, betId);
        const loserId = winnerId === bet.creatorId ? ctx.from.id : bet.creatorId;
        await db.update(usersTable).set({ totalWins: sql`total_wins + 1`, totalBets: sql`total_bets + 1`, totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}`, totalWon: sql`CAST(total_won AS DECIMAL) + ${amount * 2}` }).where(eq(usersTable.telegramId, winnerId));
        await db.update(usersTable).set({ totalLosses: sql`total_losses + 1`, totalBets: sql`total_bets + 1`, totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}` }).where(eq(usersTable.telegramId, loserId));
        await updateStreaks(winnerId, loserId);
      }

      await ctx.answerCbQuery("🪙 Coin flipped!");
      const updatedBet = await getBet(betId);
      const { betResultMessage } = await import("../messages.js");
      const { rematchKeyboard } = await import("../keyboards.js");
      await safeEdit(ctx, betResultMessage(updatedBet!, creatorName, challengerName, winnerName, "coinflip"), {
        parse_mode: "MarkdownV2",
        ...rematchKeyboard("coinflip", amount, ctx.from.id),
      });
      return;
    }

    // ── RPS: both players pick via buttons ───────────────────────────
    if (gameKey === "rps") {
      await ctx.answerCbQuery("🤜 Make your move!");
      await safeEdit(ctx, betActiveMessage(bet, creatorName, challengerName, "rps"), { parse_mode: "MarkdownV2" });
      await ctx.reply(
        `🤜 *Rock Paper Scissors — Make your move\\!*\n\n👤 ${esc(creatorName)} vs 👤 ${esc(challengerName)}\n💰 Pot: ${formatBalance(amount * 2)}\n\nBoth players pick below:`,
        { parse_mode: "MarkdownV2", ...rpsPickKeyboard(betId) }
      );
      return;
    }

    // ── Dice games ───────────────────────────────────────────────────
    await ctx.answerCbQuery(`✅ Battle started! Send ${game.telegramEmoji}`);
    await safeEdit(ctx, betActiveMessage(bet, creatorName, challengerName, gameKey), { parse_mode: "MarkdownV2" });
    await ctx.reply(
      `🔥 *Battle is ON\\!*\n\n👤 ${esc(creatorName)} vs 👤 ${esc(challengerName)}\n💰 Pot: ${formatBalance(amount * 2)}\n\nBoth players send ${game.telegramEmoji} now\\! Highest score wins\\!`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // Cancel bet — only creator
  bot.action(/^cancel_bet_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const betId = parseInt(ctx.match[1]);
    const bet = await getBet(betId);
    if (!bet) return ctx.answerCbQuery("❌ Bet not found", { show_alert: true });
    if (bet.creatorId !== ctx.from.id) return ctx.answerCbQuery("❌ Only the creator can cancel", { show_alert: true });
    if (bet.status !== "pending") return ctx.answerCbQuery("❌ Cannot cancel active bet", { show_alert: true });
    await updateBetStatus(betId, { status: "cancelled" });
    await ctx.answerCbQuery("✅ Bet cancelled");
    await safeEdit(ctx, "❌ *Bet Cancelled*\n\nNo funds were deducted\\.", { parse_mode: "MarkdownV2" });
  });

  // View bet detail — public
  bot.action(/^view_bet_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const betId = parseInt(ctx.match[1]);
    const bet = await getBet(betId);
    if (!bet) return ctx.answerCbQuery("❌ Bet not found", { show_alert: true });

    const game = GAMES[bet.gameType as GameType];
    const creator = await getUserByTelegramId(bet.creatorId);
    const creatorName = creator?.username ? `@${esc(creator.username)}` : esc(creator?.firstName || "Unknown");

    const msg = `${game.emoji} *Bet \\#${betId}*\n\n🎮 Game: ${game.name}\n💰 Amount: ${formatBalance(bet.amount)}\n👤 Creator: ${creatorName}\n📊 Status: ${bet.status.toUpperCase()}`;

    if (bet.status === "pending" && bet.creatorId !== ctx.from.id) {
      await safeEdit(ctx, msg, { parse_mode: "MarkdownV2", ...acceptBetKeyboard(betId) });
    } else {
      await safeEdit(ctx, msg, { parse_mode: "MarkdownV2", ...backToMenuKeyboard(ctx.from.id) });
    }
  });

  // Rematch: rematch_{gameKey}_{amount}_{userId}
  bot.action(/^rematch_([a-z]+)_(\d+)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const gameKey = ctx.match[1] as GameType;
    const amount = parseInt(ctx.match[2]);
    const ownerId = parseInt(ctx.match[3]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Start your own game.", { show_alert: true });
    await ctx.answerCbQuery("🔄 Rematch created!");

    const user = await getUserByTelegramId(ctx.from.id);
    if (!user || parseFloat(user.balance as string) < amount) {
      return ctx.answerCbQuery(`❌ Insufficient balance for rematch`, { show_alert: true });
    }

    if (gameKey === "coinflip") {
      pendingCoinflip.set(ctx.from.id, { amount });
      return safeEdit(ctx, `🪙 *Rematch — Coin Flip ${formatBalance(amount)}*\n\nPick your side:`, {
        parse_mode: "MarkdownV2",
        ...coinflipPickKeyboard(ctx.from.id),
      });
    }

    const bet = await createBet(ctx.from.id, gameKey, amount, ctx.chat.id);
    const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
    await safeEdit(ctx, betCreatedMessage(bet, creatorName, gameKey), {
      parse_mode: "MarkdownV2",
      ...acceptBetKeyboard(bet.id),
    });
  });

  // RPS pick: rpspick_{move}_{betId}
  bot.action(/^rpspick_(rock|paper|scissors)_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const move = ctx.match[1] as "rock" | "paper" | "scissors";
    const betId = parseInt(ctx.match[2]);
    const bet = await getBet(betId);

    if (!bet || bet.status !== "active") return ctx.answerCbQuery("❌ Bet not active", { show_alert: true });
    if (bet.creatorId !== ctx.from.id && bet.challengerId !== ctx.from.id) {
      return ctx.answerCbQuery("❌ You're not in this bet", { show_alert: true });
    }

    const isCreator = bet.creatorId === ctx.from.id;
    if (isCreator && (bet as any).creatorChoice) return ctx.answerCbQuery("⚠️ Already picked!", { show_alert: true });
    if (!isCreator && (bet as any).challengerChoice) return ctx.answerCbQuery("⚠️ Already picked!", { show_alert: true });

    await ctx.answerCbQuery(`You picked ${move === "rock" ? "🪨" : move === "paper" ? "📄" : "✂️"} ${move}!`);

    const updates: any = isCreator ? { creatorChoice: move } : { challengerChoice: move };
    await updateBetStatus(betId, updates);

    const updatedBet = await getBet(betId);
    if (!updatedBet) return;

    const bothPicked = (updatedBet as any).creatorChoice && (updatedBet as any).challengerChoice;
    if (!bothPicked) {
      await ctx.reply(`✅ Move recorded\\! Waiting for opponent\\.\\.\\.`, { parse_mode: "MarkdownV2" });
      return;
    }

    // Both picked — determine winner
    const c1Move = (updatedBet as any).creatorChoice as string;
    const c2Move = (updatedBet as any).challengerChoice as string;
    const beats: Record<string, string> = { rock: "scissors", paper: "rock", scissors: "paper" };

    const creator = await getUserByTelegramId(updatedBet.creatorId);
    const challenger = updatedBet.challengerId ? await getUserByTelegramId(updatedBet.challengerId) : null;
    const creatorName = creator?.username ? `@${creator.username}` : (creator?.firstName || "Player 1");
    const challengerName = challenger?.username ? `@${challenger.username}` : (challenger?.firstName || "Player 2");
    const amount = parseFloat(updatedBet.amount as string);

    let winnerId: number | null = null;
    let winnerName: string | null = null;
    if (beats[c1Move] === c2Move) { winnerId = updatedBet.creatorId; winnerName = creatorName; }
    else if (beats[c2Move] === c1Move) { winnerId = updatedBet.challengerId; winnerName = challengerName; }

    await updateBetStatus(betId, { status: "completed", winnerId: winnerId || undefined, completedAt: new Date() });

    if (winnerId) {
      await updateBalance(winnerId, amount * 2, "bet_win", `Won RPS bet #${betId}`, betId);
      const loserId = winnerId === updatedBet.creatorId ? updatedBet.challengerId! : updatedBet.creatorId;
      await db.update(usersTable).set({ totalWins: sql`total_wins + 1`, totalBets: sql`total_bets + 1`, totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}`, totalWon: sql`CAST(total_won AS DECIMAL) + ${amount * 2}` }).where(eq(usersTable.telegramId, winnerId));
      await db.update(usersTable).set({ totalLosses: sql`total_losses + 1`, totalBets: sql`total_bets + 1`, totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}` }).where(eq(usersTable.telegramId, loserId));
      await updateStreaks(winnerId, loserId);
    } else {
      // Tie — refund
      await updateBalance(updatedBet.creatorId, amount, "refund", `RPS tie refund #${betId}`, betId);
      if (updatedBet.challengerId) await updateBalance(updatedBet.challengerId, amount, "refund", `RPS tie refund #${betId}`, betId);
      await db.update(usersTable).set({ totalBets: sql`total_bets + 1`, totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}` }).where(eq(usersTable.telegramId, updatedBet.creatorId));
      if (updatedBet.challengerId) await db.update(usersTable).set({ totalBets: sql`total_bets + 1`, totalWagered: sql`CAST(total_wagered AS DECIMAL) + ${amount}` }).where(eq(usersTable.telegramId, updatedBet.challengerId));
    }

    const { betResultMessage } = await import("../messages.js");
    const { rematchKeyboard } = await import("../keyboards.js");
    const finalBet = await getBet(betId);
    await ctx.reply(
      betResultMessage(finalBet!, creatorName, challengerName, winnerName, "rps"),
      { parse_mode: "MarkdownV2", ...rematchKeyboard("rps", amount, ctx.from.id) }
    );
  });

  // Text handler for custom bet amounts — skip commands so they always route correctly
  bot.on("text", async (ctx, next) => {
    if (!ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next();  // never intercept commands
    const pending = pendingCustomBets.get(ctx.from.id);
    if (!pending) return next();

    pendingCustomBets.delete(ctx.from.id);
    const amount = parseFloat(ctx.message.text.trim());

    if (isNaN(amount) || amount < MIN_BET || amount > MAX_BET) {
      return ctx.reply(`❌ Amount must be between ${formatBalance(MIN_BET)} and ${formatBalance(MAX_BET)}.`);
    }

    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;
    if (parseFloat(user.balance as string) < amount) {
      return ctx.reply(`❌ Insufficient balance. You have ${formatBalance(user.balance)}`);
    }

    if (!ctx.chat) return;

    if (pending.gameKey === "coinflip") {
      pendingCoinflip.set(ctx.from.id, { amount });
      return ctx.reply(`🪙 *Coin Flip — ${formatBalance(amount)}*\n\nWhich side do you pick?`, {
        parse_mode: "MarkdownV2",
        ...coinflipPickKeyboard(ctx.from.id),
      });
    }

    const bet = await createBet(ctx.from.id, pending.gameKey, amount, ctx.chat.id);
    const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
    await ctx.reply(betCreatedMessage(bet, creatorName, pending.gameKey), {
      parse_mode: "MarkdownV2",
      ...acceptBetKeyboard(bet.id),
    });
  });
}

async function doCreateBet(ctx: Context, gameKey: GameType, amount: number) {
  if (!ctx.from || !ctx.chat) return;
  const user = await getUserByTelegramId(ctx.from.id);
  if (!user) return;

  const bet = await createBet(ctx.from.id, gameKey, amount, ctx.chat.id);
  const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");

  await safeEdit(ctx, betCreatedMessage(bet, creatorName, gameKey), {
    parse_mode: "MarkdownV2",
    ...acceptBetKeyboard(bet.id),
  });
}
