import { Telegraf, Context } from "telegraf";
import { getOrCreateUser, getUserByTelegramId, createBet, getBet, updateBetStatus, updateBalance, getActiveBets } from "../db.js";
import { betCreatedMessage, betActiveMessage, formatBalance } from "../messages.js";
import { gameSelectKeyboard, betAmountKeyboard, acceptBetKeyboard, activeBetsKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { GAMES, GameType, MIN_BET, MAX_BET } from "../config.js";
import { esc } from "../escape.js";

const pendingCustomBets = new Map<number, { gameKey: GameType }>();

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

export function registerPlayHandlers(bot: Telegraf<Context>) {
  bot.command("play", async (ctx) => {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx.from.id, { username: ctx.from.username, firstName: ctx.from.first_name });
    if (user.isBanned) return ctx.reply("🚫 You are banned from this casino.");
    await ctx.reply("🎮 *Choose your game:*", {
      parse_mode: "MarkdownV2",
      ...gameSelectKeyboard(ctx.from.id),
    });
  });

  // play_{userId} — owner only
  bot.action(/^play_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    const user = await getUserByTelegramId(ctx.from.id);
    if (user?.isBanned) return ctx.answerCbQuery("🚫 You are banned.", { show_alert: true });
    await safeEdit(ctx, "🎮 *Choose your game:*", {
      parse_mode: "MarkdownV2",
      ...gameSelectKeyboard(ctx.from.id),
    });
  });

  bot.command("bets", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const bets = await getActiveBets(ctx.chat.id);
    await ctx.reply("🎲 *Active Bets in This Chat:*", {
      parse_mode: "MarkdownV2",
      ...activeBetsKeyboard(bets, ctx.from.id),
    });
  });

  // active_bets_{userId} — owner only
  bot.action(/^active_bets_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /bets to see bets.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    const bets = await getActiveBets(ctx.chat.id);
    await safeEdit(ctx, "🎲 *Active Bets in This Chat:*", {
      parse_mode: "MarkdownV2",
      ...activeBetsKeyboard(bets, ctx.from.id),
    });
  });

  // Game selection: game_{gameKey}_{userId}
  bot.action(/^game_([a-z]+)_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const gameKey = ctx.match[1] as GameType;
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    }
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
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    }
    if (!GAMES[gameKey]) return;
    await ctx.answerCbQuery();

    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;
    if (parseFloat(user.balance as string) < amount) {
      return ctx.answerCbQuery(`❌ Need ${formatBalance(amount)} — you have ${formatBalance(user.balance)}`, { show_alert: true });
    }
    await doCreateBet(ctx, gameKey, amount);
  });

  // Custom amount: betcustom_{gameKey}_{userId}
  bot.action(/^betcustom_([a-z]+)_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const gameKey = ctx.match[1] as GameType;
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    pendingCustomBets.set(ctx.from.id, { gameKey });
    await safeEdit(ctx,
      `✏️ *Enter Custom Bet Amount*\n\nRange: ${formatBalance(MIN_BET)} — ${formatBalance(MAX_BET)}\n\nType the number below:`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // Accept bet — anyone except creator can accept
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

  // View bet detail — public, anyone can view
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

  // Text handler for custom bet amounts
  bot.on("text", async (ctx, next) => {
    if (!ctx.from) return next();
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
    const bet = await createBet(ctx.from.id, pending.gameKey, amount, ctx.chat.id);
    const game = GAMES[pending.gameKey];
    const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
    await ctx.reply(
      betCreatedMessage(bet, creatorName, pending.gameKey),
      { parse_mode: "MarkdownV2", ...acceptBetKeyboard(bet.id) }
    );
  });
}

async function doCreateBet(ctx: Context, gameKey: GameType, amount: number) {
  if (!ctx.from || !ctx.chat) return;
  const user = await getUserByTelegramId(ctx.from.id);
  if (!user) return;

  const bet = await createBet(ctx.from.id, gameKey, amount, ctx.chat.id);
  const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");

  await safeEdit(ctx,
    betCreatedMessage(bet, creatorName, gameKey),
    { parse_mode: "MarkdownV2", ...acceptBetKeyboard(bet.id) }
  );
}
