import { Telegraf, Context, Markup } from "telegraf";
import {
  getOrCreateUser, getUserByTelegramId, createBet, getBet,
  updateBetStatus, updateBalance, updateStreaks, getActiveBets, awardTieXP,
  getUserPendingBetsCount,
} from "../db.js";
import { betCreatedMessage, betActiveMessage, formatBalance, mv2Num } from "../messages.js";
import {
  gameSelectKeyboard, betAmountKeyboard, coinflipPickKeyboard,
  acceptBetKeyboard, activeBetsKeyboard, backToMenuKeyboard, rpsPickKeyboard,
  baccaratPickKeyboard, dragonPickKeyboard, evenoddPickKeyboard,
} from "../keyboards.js";
import { GAMES, GameType, MIN_BET, MAX_BET } from "../config.js";
import { esc } from "../escape.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

const pendingCustomBets = new Map<number, { gameKey: GameType }>();
const pendingCoinflip  = new Map<number, { amount: number }>();
const pendingBaccarat  = new Map<number, { amount: number }>();
const pendingDragon    = new Map<number, { amount: number }>();
const pendingEvenOdd   = new Map<number, { amount: number }>();

// ── Anti-spam ─────────────────────────────────────────────────────────────────
const PIN_THRESHOLD    = 1500;   // pin bets at or above this amount
const BET_COOLDOWN_MS  = 10_000; // 10 s cooldown between bet creations
const MAX_PENDING_BETS = 2;      // max simultaneous pending bets per user

const lastBetTime = new Map<number, number>(); // userId → last bet timestamp

async function checkSpamLimit(ctx: Context, userId: number): Promise<boolean> {
  const now = Date.now();
  const last = lastBetTime.get(userId) ?? 0;
  if (now - last < BET_COOLDOWN_MS) {
    const secs = Math.ceil((BET_COOLDOWN_MS - (now - last)) / 1000);
    await ctx.reply(`⏳ Slow down\\! Wait *${secs}s* before creating another bet\\.`, { parse_mode: "MarkdownV2" });
    return true; // spamming
  }
  const pending = await getUserPendingBetsCount(userId);
  if (pending >= MAX_PENDING_BETS) {
    await ctx.reply(
      `⚠️ You already have *${pending} pending bets*\\. Accept or cancel them first\\.`,
      { parse_mode: "MarkdownV2" }
    );
    return true;
  }
  return false;
}

async function tryPin(ctx: Context, betId: number, chatId: number, messageId: number) {
  try {
    await ctx.telegram.pinChatMessage(chatId, messageId, { disable_notification: true });
    await updateBetStatus(betId, { pinMessageId: messageId, pinChatId: chatId });
  } catch { /* no admin rights or DM — silently skip */ }
}

async function tryUnpin(ctx: Context, bet: any) {
  if (!bet?.pinMessageId || !bet?.pinChatId) return;
  try {
    await ctx.telegram.unpinChatMessage(bet.pinChatId, bet.pinMessageId);
    await updateBetStatus(bet.id, { pinMessageId: null, pinChatId: null });
  } catch { /* silently skip */ }
}

// Maps for choice games
const CHOICE_GAMES = ["baccarat", "dragon", "evenodd"] as const;
type ChoiceGame = typeof CHOICE_GAMES[number];

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

function privateChatWarning(ctx: Context) {
  const botUsername = process.env.BOT_USERNAME || "AdsRewardGameBot";
  return ctx.reply(
    "⚠️ *Bets need a group chat\\!*\n\nPvP bets require at least 2 players in a group\\. Add the bot to a group and create bets there so opponents can join\\!\n\n_You can still use /wallet, /stats, /deposit, /daily here\\._",
    {
      parse_mode: "MarkdownV2",
      ...Markup.inlineKeyboard([
        [Markup.button.url("➕ Add Bot to a Group", `https://t.me/${botUsername}?startgroup=true`)],
      ]),
    }
  );
}

/** Validate and create a quick-bet from a command, e.g. /dice 500 */
async function quickBet(ctx: Context, gameKey: GameType, rawAmount: string | undefined) {
  if (!ctx.from || !ctx.chat) return;

  if (isPrivateChat(ctx)) return privateChatWarning(ctx);

  const user = await getOrCreateUser(ctx.from.id, {
    username: ctx.from.username,
    firstName: ctx.from.first_name,
  });

  if (user.isBanned) return ctx.reply("🚫 You are banned from this casino.");

  const game = GAMES[gameKey];

  // Choice games: coinflip, baccarat, dragon, evenodd require picking a side first
  const PICK_KEYBOARDS: Record<string, (uid: number) => ReturnType<typeof Markup.inlineKeyboard>> = {
    coinflip: coinflipPickKeyboard,
    baccarat: baccaratPickKeyboard,
    dragon:   dragonPickKeyboard,
    evenodd:  evenoddPickKeyboard,
  };
  const PICK_PENDING_MAPS: Record<string, Map<number, { amount: number }>> = {
    coinflip: pendingCoinflip,
    baccarat: pendingBaccarat,
    dragon:   pendingDragon,
    evenodd:  pendingEvenOdd,
  };
  if (gameKey in PICK_KEYBOARDS) {
    if (!rawAmount || rawAmount.trim() === "") {
      return ctx.reply(
        `${game.emoji} *${game.name} — Pick Amount*\n\nUsage: \`/${gameKey} <amount>\`\n\nRange: ${mv2Num(MIN_BET)} — ${mv2Num(MAX_BET)}`,
        { parse_mode: "MarkdownV2", ...betAmountKeyboard(gameKey, ctx.from.id) }
      );
    }
    const amount = parseFloat(rawAmount.trim());
    if (isNaN(amount) || amount < MIN_BET || amount > MAX_BET) {
      return ctx.reply(`❌ Amount must be between ${mv2Num(MIN_BET)} and ${mv2Num(MAX_BET)}\\.`, { parse_mode: "MarkdownV2" });
    }
    if (parseFloat(user.balance as string) < amount) {
      return ctx.reply(`❌ Insufficient balance\\. You need ${mv2Num(amount)}\\.`, { parse_mode: "MarkdownV2" });
    }
    PICK_PENDING_MAPS[gameKey].set(ctx.from.id, { amount });
    return ctx.reply(`${game.emoji} *${game.name} — ${mv2Num(amount)}*\n\nChoose your side:`, {
      parse_mode: "MarkdownV2",
      ...PICK_KEYBOARDS[gameKey](ctx.from.id),
    });
  }

  if (!rawAmount || rawAmount.trim() === "") {
    return ctx.reply(
      `${game.emoji} *${game.name} — Quick Bet*\n\nUsage: \`/${gameKey} <amount>\`\nRange: ${mv2Num(MIN_BET)} — ${mv2Num(MAX_BET)}`,
      { parse_mode: "MarkdownV2", ...betAmountKeyboard(gameKey, ctx.from.id) }
    );
  }

  const amount = parseFloat(rawAmount.trim());
  if (isNaN(amount) || amount < MIN_BET || amount > MAX_BET) {
    return ctx.reply(`❌ Amount must be between ${mv2Num(MIN_BET)} and ${mv2Num(MAX_BET)}\\.`, { parse_mode: "MarkdownV2" });
  }
  if (parseFloat(user.balance as string) < amount) {
    return ctx.reply(`❌ Insufficient balance\\. You need ${mv2Num(amount)} but have ${mv2Num(user.balance)}\\.`, { parse_mode: "MarkdownV2" });
  }

  if (await checkSpamLimit(ctx, ctx.from.id)) return;

  const bet = await createBet(ctx.from.id, gameKey, amount, ctx.chat.id);
  lastBetTime.set(ctx.from.id, Date.now());
  const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
  const sent = await ctx.reply(betCreatedMessage(bet, creatorName, gameKey), {
    parse_mode: "MarkdownV2",
    ...acceptBetKeyboard(bet.id),
  });
  if (amount >= PIN_THRESHOLD) {
    await tryPin(ctx, bet.id, ctx.chat.id, sent.message_id);
  }
}

export function registerPlayHandlers(bot: Telegraf<Context>) {
  // Full play menu
  bot.command("play", async (ctx) => {
    if (!ctx.from) return;
    if (isPrivateChat(ctx)) return privateChatWarning(ctx);
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
  bot.command("highcard",   ctx => quickBet(ctx, "highcard",   ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("baccarat",   ctx => quickBet(ctx, "baccarat",   ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("dragon",     ctx => quickBet(ctx, "dragon",     ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("evenodd",    ctx => quickBet(ctx, "evenodd",    ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("lucky7",     ctx => quickBet(ctx, "lucky7",     ctx.message.text.split(" ").slice(1).join(" ")));
  bot.command("wheel",      ctx => quickBet(ctx, "wheel",      ctx.message.text.split(" ").slice(1).join(" ")));
  // ────────────────────────────────────────────────────────────────────────

  // play_{userId}
  bot.action(/^play_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /play to create your own bet.", { show_alert: true });
    if (isPrivateChat(ctx)) {
      await ctx.answerCbQuery("⚠️ Bets need a group chat!", { show_alert: true });
      return privateChatWarning(ctx);
    }
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

    if (await checkSpamLimit(ctx, ctx.from.id)) return;

    // Choice games: show side-pick keyboard before creating bet
    if (gameKey === "coinflip") {
      pendingCoinflip.set(ctx.from.id, { amount });
      return safeEdit(ctx, `🪙 *Coin Flip — ${mv2Num(amount)}*\n\nWhich side do you pick?`, {
        parse_mode: "MarkdownV2", ...coinflipPickKeyboard(ctx.from.id),
      });
    }
    if (gameKey === "baccarat") {
      pendingBaccarat.set(ctx.from.id, { amount });
      return safeEdit(ctx, `🀄 *Baccarat — ${mv2Num(amount)}*\n\nChoose your side:`, {
        parse_mode: "MarkdownV2", ...baccaratPickKeyboard(ctx.from.id),
      });
    }
    if (gameKey === "dragon") {
      pendingDragon.set(ctx.from.id, { amount });
      return safeEdit(ctx, `🐉 *Dragon Tiger — ${mv2Num(amount)}*\n\nChoose your side:`, {
        parse_mode: "MarkdownV2", ...dragonPickKeyboard(ctx.from.id),
      });
    }
    if (gameKey === "evenodd") {
      pendingEvenOdd.set(ctx.from.id, { amount });
      return safeEdit(ctx, `⚡ *Even \\/ Odd — ${mv2Num(amount)}*\n\nChoose your prediction:`, {
        parse_mode: "MarkdownV2", ...evenoddPickKeyboard(ctx.from.id),
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
    lastBetTime.set(ctx.from.id, Date.now());
    const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
    await safeEdit(ctx, betCreatedMessage(bet, creatorName, "coinflip"), {
      parse_mode: "MarkdownV2",
      ...acceptBetKeyboard(bet.id),
    });
    const msgId = (ctx.callbackQuery as any)?.message?.message_id;
    if (pending.amount >= PIN_THRESHOLD && msgId) {
      await tryPin(ctx, bet.id, ctx.chat.id, msgId);
    }
  });

  // Baccarat side pick: bacpick_{player|banker}_{userId}
  bot.action(/^bacpick_(player|banker)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const side = ctx.match[1] as "player" | "banker";
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your bet.", { show_alert: true });
    const pending = pendingBaccarat.get(ctx.from.id);
    if (!pending) return ctx.answerCbQuery("❌ Session expired, start over.", { show_alert: true });
    pendingBaccarat.delete(ctx.from.id);
    await ctx.answerCbQuery(`You picked ${side === "player" ? "🎰 Player" : "🏦 Banker"}`);
    const user = await getUserByTelegramId(ctx.from.id);
    if (!user || parseFloat(user.balance as string) < pending.amount) {
      return safeEdit(ctx, `❌ Insufficient balance\\.`, { parse_mode: "MarkdownV2" });
    }
    const bet = await createBet(ctx.from.id, "baccarat", pending.amount, ctx.chat.id, undefined, side);
    lastBetTime.set(ctx.from.id, Date.now());
    const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
    await safeEdit(ctx, betCreatedMessage(bet, creatorName, "baccarat"), {
      parse_mode: "MarkdownV2", ...acceptBetKeyboard(bet.id),
    });
    const msgId = (ctx.callbackQuery as any)?.message?.message_id;
    if (pending.amount >= PIN_THRESHOLD && msgId) await tryPin(ctx, bet.id, ctx.chat.id, msgId);
  });

  // Dragon Tiger pick: drpick_{dragon|tiger}_{userId}
  bot.action(/^drpick_(dragon|tiger)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const side = ctx.match[1] as "dragon" | "tiger";
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your bet.", { show_alert: true });
    const pending = pendingDragon.get(ctx.from.id);
    if (!pending) return ctx.answerCbQuery("❌ Session expired, start over.", { show_alert: true });
    pendingDragon.delete(ctx.from.id);
    await ctx.answerCbQuery(`You picked ${side === "dragon" ? "🐉 Dragon" : "🐯 Tiger"}`);
    const user = await getUserByTelegramId(ctx.from.id);
    if (!user || parseFloat(user.balance as string) < pending.amount) {
      return safeEdit(ctx, `❌ Insufficient balance\\.`, { parse_mode: "MarkdownV2" });
    }
    const bet = await createBet(ctx.from.id, "dragon", pending.amount, ctx.chat.id, undefined, side);
    lastBetTime.set(ctx.from.id, Date.now());
    const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
    await safeEdit(ctx, betCreatedMessage(bet, creatorName, "dragon"), {
      parse_mode: "MarkdownV2", ...acceptBetKeyboard(bet.id),
    });
    const msgId = (ctx.callbackQuery as any)?.message?.message_id;
    if (pending.amount >= PIN_THRESHOLD && msgId) await tryPin(ctx, bet.id, ctx.chat.id, msgId);
  });

  // Even/Odd pick: eopick_{even|odd}_{userId}
  bot.action(/^eopick_(even|odd)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const side = ctx.match[1] as "even" | "odd";
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your bet.", { show_alert: true });
    const pending = pendingEvenOdd.get(ctx.from.id);
    if (!pending) return ctx.answerCbQuery("❌ Session expired, start over.", { show_alert: true });
    pendingEvenOdd.delete(ctx.from.id);
    await ctx.answerCbQuery(`You picked ${side === "even" ? "2️⃣ Even" : "1️⃣ Odd"}`);
    const user = await getUserByTelegramId(ctx.from.id);
    if (!user || parseFloat(user.balance as string) < pending.amount) {
      return safeEdit(ctx, `❌ Insufficient balance\\.`, { parse_mode: "MarkdownV2" });
    }
    const bet = await createBet(ctx.from.id, "evenodd", pending.amount, ctx.chat.id, undefined, side);
    lastBetTime.set(ctx.from.id, Date.now());
    const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");
    await safeEdit(ctx, betCreatedMessage(bet, creatorName, "evenodd"), {
      parse_mode: "MarkdownV2", ...acceptBetKeyboard(bet.id),
    });
    const msgId = (ctx.callbackQuery as any)?.message?.message_id;
    if (pending.amount >= PIN_THRESHOLD && msgId) await tryPin(ctx, bet.id, ctx.chat.id, msgId);
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
      `✏️ *Enter Custom Bet Amount*\n\nRange: ${mv2Num(MIN_BET)} — ${mv2Num(MAX_BET)}\n\nType the number below:`,
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
    await tryUnpin(ctx, bet);

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

    // ── New instant games: resolve on accept ─────────────────────────
    const INSTANT_GAMES = ["highcard", "baccarat", "dragon", "evenodd", "lucky7", "wheel"];
    if (INSTANT_GAMES.includes(gameKey)) {
      let cScore = 0, chScore = 0;
      let winnerId: number | null = null;
      let winnerName: string | null = null;
      let challengerChoice = "";

      if (gameKey === "highcard") {
        cScore  = Math.floor(Math.random() * 13) + 1;
        chScore = Math.floor(Math.random() * 13) + 1;
        if (cScore === chScore) {
          cScore  = Math.floor(Math.random() * 13) + 1;
          chScore = Math.floor(Math.random() * 13) + 1;
        }
        if (cScore >= chScore) { winnerId = bet.creatorId; winnerName = creatorName; }
        else                   { winnerId = ctx.from.id;   winnerName = challengerName; }

      } else if (gameKey === "baccarat") {
        cScore  = Math.floor(Math.random() * 10); // Player val 0-9
        chScore = Math.floor(Math.random() * 10); // Banker val 0-9
        challengerChoice = bet.creatorChoice === "player" ? "banker" : "player";
        const playerWins = cScore >= chScore; // tie → player wins
        const winnerSide = playerWins ? "player" : "banker";
        if (bet.creatorChoice === winnerSide) { winnerId = bet.creatorId; winnerName = creatorName; }
        else                                  { winnerId = ctx.from.id;   winnerName = challengerName; }

      } else if (gameKey === "dragon") {
        cScore  = Math.floor(Math.random() * 13) + 1; // card 1–13
        chScore = cScore;
        challengerChoice = bet.creatorChoice === "dragon" ? "tiger" : "dragon";
        const resultSide = cScore >= 7 ? "dragon" : "tiger";
        if (bet.creatorChoice === resultSide) { winnerId = bet.creatorId; winnerName = creatorName; }
        else                                  { winnerId = ctx.from.id;   winnerName = challengerName; }

      } else if (gameKey === "evenodd") {
        cScore  = Math.floor(Math.random() * 6) + 1; // die 1–6
        chScore = cScore;
        challengerChoice = bet.creatorChoice === "even" ? "odd" : "even";
        const parity = cScore % 2 === 0 ? "even" : "odd";
        if (bet.creatorChoice === parity) { winnerId = bet.creatorId; winnerName = creatorName; }
        else                              { winnerId = ctx.from.id;   winnerName = challengerName; }

      } else if (gameKey === "lucky7") {
        cScore  = Math.floor(Math.random() * 13) + 1;
        chScore = Math.floor(Math.random() * 13) + 1;
        const d1 = Math.abs(7 - cScore), d2 = Math.abs(7 - chScore);
        if (d1 <= d2) { winnerId = bet.creatorId; winnerName = creatorName; }
        else          { winnerId = ctx.from.id;   winnerName = challengerName; }

      } else if (gameKey === "wheel") {
        cScore  = Math.floor(Math.random() * 8) + 1;
        chScore = Math.floor(Math.random() * 8) + 1;
        if (cScore >= chScore) { winnerId = bet.creatorId; winnerName = creatorName; }
        else                   { winnerId = ctx.from.id;   winnerName = challengerName; }
      }

      await updateBetStatus(betId, {
        status: "completed",
        challengerId: ctx.from.id,
        challengerChoice: challengerChoice || undefined,
        creatorScore: cScore,
        challengerScore: chScore,
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

      await ctx.answerCbQuery(`${game.emoji} Game resolved!`);
      const updBet = await getBet(betId);
      const { betResultMessage } = await import("../messages.js");
      const { rematchKeyboard } = await import("../keyboards.js");
      await safeEdit(ctx, betResultMessage(updBet!, creatorName, challengerName, winnerName, gameKey), {
        parse_mode: "MarkdownV2",
        ...rematchKeyboard(gameKey, amount, ctx.from.id),
      });
      return;
    }

    // ── RPS: both players pick via buttons ───────────────────────────
    if (gameKey === "rps") {
      await ctx.answerCbQuery("🤜 Make your move!");
      await safeEdit(ctx, betActiveMessage(bet, creatorName, challengerName, "rps"), { parse_mode: "MarkdownV2" });
      await ctx.reply(
        `🤜 *Rock Paper Scissors — Make your move\\!*\n\n👤 ${esc(creatorName)} vs 👤 ${esc(challengerName)}\n💰 Pot: ${mv2Num(amount * 2)}\n\nBoth players pick below:`,
        { parse_mode: "MarkdownV2", ...rpsPickKeyboard(betId) }
      );
      return;
    }

    // ── Dice games ───────────────────────────────────────────────────
    await ctx.answerCbQuery(`✅ Battle started! Send ${game.telegramEmoji}`);
    await safeEdit(ctx, betActiveMessage(bet, creatorName, challengerName, gameKey), { parse_mode: "MarkdownV2" });
    await ctx.reply(
      `🔥 *Battle is ON\\!*\n\n👤 ${esc(creatorName)} vs 👤 ${esc(challengerName)}\n💰 Pot: ${mv2Num(amount * 2)}\n\nBoth players send ${game.telegramEmoji} now\\! Highest score wins\\!`,
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
    await tryUnpin(ctx, bet);
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

    const msg = `${game.emoji} *Bet \\#${betId}*\n\n🎮 Game: ${game.name}\n💰 Amount: ${mv2Num(bet.amount)}\n👤 Creator: ${creatorName}\n📊 Status: ${bet.status.toUpperCase()}`;

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
      return safeEdit(ctx, `🪙 *Rematch — Coin Flip ${mv2Num(amount)}*\n\nPick your side:`, {
        parse_mode: "MarkdownV2", ...coinflipPickKeyboard(ctx.from.id),
      });
    }
    if (gameKey === "baccarat") {
      pendingBaccarat.set(ctx.from.id, { amount });
      return safeEdit(ctx, `🀄 *Rematch — Baccarat ${mv2Num(amount)}*\n\nChoose your side:`, {
        parse_mode: "MarkdownV2", ...baccaratPickKeyboard(ctx.from.id),
      });
    }
    if (gameKey === "dragon") {
      pendingDragon.set(ctx.from.id, { amount });
      return safeEdit(ctx, `🐉 *Rematch — Dragon Tiger ${mv2Num(amount)}*\n\nChoose your side:`, {
        parse_mode: "MarkdownV2", ...dragonPickKeyboard(ctx.from.id),
      });
    }
    if (gameKey === "evenodd") {
      pendingEvenOdd.set(ctx.from.id, { amount });
      return safeEdit(ctx, `⚡ *Rematch — Even \\/Odd ${mv2Num(amount)}*\n\nChoose your prediction:`, {
        parse_mode: "MarkdownV2", ...evenoddPickKeyboard(ctx.from.id),
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
      awardTieXP(updatedBet.creatorId, updatedBet.challengerId ?? null);
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
      return ctx.reply(`🪙 *Coin Flip — ${mv2Num(amount)}*\n\nWhich side do you pick?`, {
        parse_mode: "MarkdownV2", ...coinflipPickKeyboard(ctx.from.id),
      });
    }
    if (pending.gameKey === "baccarat") {
      pendingBaccarat.set(ctx.from.id, { amount });
      return ctx.reply(`🀄 *Baccarat — ${mv2Num(amount)}*\n\nChoose your side:`, {
        parse_mode: "MarkdownV2", ...baccaratPickKeyboard(ctx.from.id),
      });
    }
    if (pending.gameKey === "dragon") {
      pendingDragon.set(ctx.from.id, { amount });
      return ctx.reply(`🐉 *Dragon Tiger — ${mv2Num(amount)}*\n\nChoose your side:`, {
        parse_mode: "MarkdownV2", ...dragonPickKeyboard(ctx.from.id),
      });
    }
    if (pending.gameKey === "evenodd") {
      pendingEvenOdd.set(ctx.from.id, { amount });
      return ctx.reply(`⚡ *Even \\/Odd — ${mv2Num(amount)}*\n\nChoose your prediction:`, {
        parse_mode: "MarkdownV2", ...evenoddPickKeyboard(ctx.from.id),
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
  lastBetTime.set(ctx.from.id, Date.now());
  const creatorName = user.username ? `@${user.username}` : (user.firstName || "Player");

  await safeEdit(ctx, betCreatedMessage(bet, creatorName, gameKey), {
    parse_mode: "MarkdownV2",
    ...acceptBetKeyboard(bet.id),
  });
  const msgId = (ctx.callbackQuery as any)?.message?.message_id;
  if (amount >= PIN_THRESHOLD && msgId) {
    await tryPin(ctx, bet.id, ctx.chat.id, msgId);
  }
}
