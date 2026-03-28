/**
 * USDT Betting via Cwallet TipBot (@CWalletBot)
 *
 * Flow:
 *  1. Creator runs /usdt → picks game → picks amount → picks side (choice games)
 *  2. Bot creates pending bet and shows tip instruction
 *  3. Creator sends:  /tip @CASINO_ACCOUNT <amount> USDT  in this chat via @CWalletBot
 *  4. Bot detects @CWalletBot confirmation → bet becomes "awaiting_opponent"
 *  5. Opponent clicks "Join" → (picks side for choice games) → sees tip instruction
 *  6. Opponent tips → both paid → game resolves (instant) or dice starts
 *  7. Winner is sent payout via userbot tip command  (or admin is notified if userbot offline)
 *
 * Requires bot PRIVACY MODE OFF in groups (@BotFather → /mybots → Bot Settings → Group Privacy → Disable)
 * so the bot can see @CWalletBot messages.
 */

import { Telegraf, Context, Markup } from "telegraf";
import type { Message } from "telegraf/types";
import { db } from "@workspace/db";
import { usdtBetsTable } from "@workspace/db/schema";
import type { UsdtBet } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  GAMES, GameType, DICE_GAMES,
  ADMIN_IDS, USDT_AMOUNTS, USDT_MIN_AMOUNT, USDT_MAX_AMOUNT,
  USDT_PUBLIC, CASINO_ACCOUNT, CWALLET_BOT,
  USDT_HOUSE_FEE_PERCENT, USDT_PAYMENT_EXPIRY_MINUTES, USDT_JOIN_EXPIRY_MINUTES,
  EMOJI_TO_GAME,
} from "../config.js";
import { getOrCreateUser } from "../db.js";
import { esc } from "../escape.js";
import { sendUsdtPayout, isUserbotReady } from "../userbot.js";

// ── Pending UI state ───────────────────────────────────────────────────────────
// userId → currently selected game (while user is picking amount)
const pendingGame   = new Map<number, { game: GameType; chatId: number }>();
// userId → game+chatId waiting for a custom amount text input
const pendingCustom = new Map<number, { game: GameType; chatId: number }>();
// userId → betId (opponent has clicked Join, about to pay)
const pendingJoin   = new Map<number, number>();
// USDT RPS: betId → { creatorChoice?, opponentChoice? }
const rpsChoices    = new Map<number, { creator?: string; opponent?: string }>();

// ── Helpers ────────────────────────────────────────────────────────────────────

function isAdmin(uid: number)    { return ADMIN_IDS.includes(uid); }
function canUseUsdt(uid: number) { return USDT_PUBLIC || isAdmin(uid); }

function fmtUsdt(n: number | string): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  const s = v.toFixed(4).replace(/\.?0+$/, "") || "0";
  return `${s} USDT`;
}

function mv2Usdt(n: number | string): string {
  return fmtUsdt(n).replace(".", "\\.");
}

function payoutAmt(bet: number | string, feePct: number | string = USDT_HOUSE_FEE_PERCENT): number {
  const b = typeof bet   === "string" ? parseFloat(bet)   : bet;
  const f = typeof feePct=== "string" ? parseFloat(feePct): feePct;
  return parseFloat((b * 2 * (1 - f / 100)).toFixed(4));
}

function oppositeChoice(game: GameType, choice: string): string {
  const pairs: Record<string, Record<string, string>> = {
    coinflip: { heads: "tails", tails: "heads" },
    baccarat: { player: "banker", banker: "player" },
    dragon:   { dragon: "tiger", tiger: "dragon" },
    evenodd:  { even: "odd",     odd: "even" },
  };
  return pairs[game]?.[choice] ?? choice;
}

const CHOICE_GAMES: GameType[] = ["coinflip", "baccarat", "dragon", "evenodd"];
const INSTANT_NO_CHOICE_GAMES: GameType[] = ["highcard", "lucky7", "wheel"];
const INSTANT_GAMES: GameType[] = [...CHOICE_GAMES, "rps", ...INSTANT_NO_CHOICE_GAMES];

function isPrivate(ctx: Context) { return ctx.chat?.type === "private"; }

async function safeEdit(ctx: Context, text: string, extra: any) {
  try { await ctx.editMessageText(text, extra); } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

// ── Bet message ────────────────────────────────────────────────────────────────

function buildMsg(bet: UsdtBet): string {
  const game   = GAMES[bet.gameType as GameType];
  const amt    = parseFloat(bet.usdtAmount    as string);
  const fee    = parseFloat(bet.houseFeePercent as string);
  const payout = payoutAmt(amt, fee);

  const cName  = bet.creatorUsername  ? `@${esc(bet.creatorUsername)}`  : `User\\#${bet.creatorId}`;
  const oName  = bet.opponentUsername ? `@${esc(bet.opponentUsername)}` :
                 bet.opponentId       ? `User\\#${bet.opponentId}`      : "_Open_";

  const cChoice = bet.creatorChoice  ? ` \\(${esc(bet.creatorChoice)}\\)`  : "";
  const oChoice = bet.opponentChoice ? ` \\(${esc(bet.opponentChoice)}\\)` : "";

  const cStatus = bet.status === "awaiting_payment" ? "⏳ Awaiting payment" : "✅ Paid";
  const oStatus = !bet.opponentId ? "—"
    : bet.status === "awaiting_opponent" ? "⏳ Awaiting payment"
    : "✅ Paid";

  const statusLabels: Record<string, string> = {
    awaiting_payment:  "💳 Awaiting creator payment",
    awaiting_opponent: "🔍 Open — waiting for opponent",
    active:            "🎮 Game in progress",
    completed:         bet.winnerId ? "🏆 Completed" : "🤝 Tie",
    cancelled:         "❌ Cancelled",
  };

  return [
    `💎 *USDT Bet \\#${bet.id}*`,
    ``,
    `🎮 Game: *${esc(game.name)}* ${game.emoji}`,
    `💰 Amount: *${mv2Usdt(amt)}* each`,
    `🏆 Pot: *${mv2Usdt(amt * 2)}*  •  Fee: ${fee}%`,
    `🎁 Winner gets: *${mv2Usdt(payout)}*`,
    ``,
    `👤 Creator: ${cName}${cChoice}  ${cStatus}`,
    `🆚 Opponent: ${oName}${oChoice}  ${oStatus}`,
    ``,
    `📊 ${statusLabels[bet.status] ?? bet.status}`,
  ].join("\n");
}

// ── @CWalletBot tip parser ────────────────────────────────────────────────────

function parseTip(text: string): { fromUsername: string; amount: number } | null {
  const casinoLc = CASINO_ACCOUNT.toLowerCase();
  const lc = text.toLowerCase();
  if (!lc.includes(casinoLc) || !lc.includes("usdt")) return null;

  const amtM = text.match(/([\d]+\.[\d]+|[\d]+)\s*USDT/i);
  if (!amtM) return null;
  const amount = parseFloat(amtM[1]);
  if (isNaN(amount) || amount <= 0) return null;

  const mentions = [...text.matchAll(/@(\w+)/g)].map(m => m[1].toLowerCase());
  const from = mentions.find(u => u !== casinoLc);
  if (!from) return null;

  return { fromUsername: from, amount };
}

// ── Tip matching & bet activation ─────────────────────────────────────────────

async function handleTipDetected(
  fromUsername: string,
  amount: number,
  chatId: number,
  bot: Telegraf<Context>
): Promise<void> {
  const tol = 0.0001; // floating-point tolerance

  // 1. Creator paying — look for bets in "awaiting_payment" by this user
  const awaitingCreator = await db.select().from(usdtBetsTable).where(
    and(eq(usdtBetsTable.chatId, chatId), eq(usdtBetsTable.status, "awaiting_payment"))
  ).orderBy(desc(usdtBetsTable.createdAt)).limit(10);

  const creatorBet = awaitingCreator.find(b =>
    b.creatorUsername?.toLowerCase() === fromUsername &&
    Math.abs(parseFloat(b.usdtAmount as string) - amount) < tol
  );

  if (creatorBet) {
    const expires = new Date(Date.now() + USDT_JOIN_EXPIRY_MINUTES * 60_000);
    await db.update(usdtBetsTable)
      .set({ status: "awaiting_opponent", expiresAt: expires })
      .where(eq(usdtBetsTable.id, creatorBet.id));

    const updated = (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, creatorBet.id)).limit(1))[0];
    if (updated?.betMessageId) {
      try {
        await bot.telegram.editMessageText(
          chatId, updated.betMessageId, undefined, buildMsg(updated),
          { parse_mode: "MarkdownV2", ...joinKb(updated.id) }
        );
        await bot.telegram.pinChatMessage(chatId, updated.betMessageId).catch(() => {});
      } catch {}
    }
    await bot.telegram.sendMessage(chatId,
      `✅ *Payment confirmed\\!* USDT Bet \\#${creatorBet.id} is now *open* — anyone can join above\\!`,
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  // 2. Opponent paying — look for bets in "awaiting_opponent" where opponent username matches
  const awaitingOpp = await db.select().from(usdtBetsTable).where(
    and(eq(usdtBetsTable.chatId, chatId), eq(usdtBetsTable.status, "awaiting_opponent"))
  ).orderBy(desc(usdtBetsTable.createdAt)).limit(10);

  const oppBet = awaitingOpp.find(b =>
    b.opponentUsername?.toLowerCase() === fromUsername &&
    Math.abs(parseFloat(b.usdtAmount as string) - amount) < tol
  );

  if (oppBet) {
    await activateBet(oppBet, bot);
  }
}

// ── Activate (both paid) ───────────────────────────────────────────────────────

async function activateBet(bet: UsdtBet, bot: Telegraf<Context>): Promise<void> {
  const game   = GAMES[bet.gameType as GameType];
  const isDice = DICE_GAMES.includes(bet.gameType as GameType);
  const cName  = bet.creatorUsername  ? `@${bet.creatorUsername}`  : `User#${bet.creatorId}`;
  const oName  = bet.opponentUsername ? `@${bet.opponentUsername}` : `User#${bet.opponentId}`;
  const amt    = parseFloat(bet.usdtAmount as string);

  // Instant-resolve games
  if (INSTANT_GAMES.includes(bet.gameType as GameType)) {
    if (bet.gameType === "rps") {
      await db.update(usdtBetsTable).set({ status: "active" }).where(eq(usdtBetsTable.id, bet.id));
      await bot.telegram.sendMessage(bet.chatId,
        `💎 *USDT RPS \\#${bet.id} — Pick your move\\!*\n\n👤 ${esc(cName)} vs 👤 ${esc(oName)}\n💰 ${mv2Usdt(amt)} each`,
        { parse_mode: "MarkdownV2", ...rpsKb(bet.id) }
      );
    } else {
      await resolveInstant(bet, bot);
    }
    return;
  }

  // Dice games
  await db.update(usdtBetsTable).set({ status: "active" }).where(eq(usdtBetsTable.id, bet.id));
  const updated = (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, bet.id)).limit(1))[0];
  if (updated?.betMessageId) {
    try {
      await bot.telegram.editMessageText(bet.chatId, updated.betMessageId, undefined,
        buildMsg(updated), { parse_mode: "MarkdownV2" }
      );
    } catch {}
  }
  await bot.telegram.sendMessage(bet.chatId,
    `🔥 *USDT Battle \\#${bet.id} is ON\\!*\n\n👤 ${esc(cName)} vs 👤 ${esc(oName)}\n💎 Pot: *${mv2Usdt(amt * 2)}*\n\nBoth players send ${game.telegramEmoji} — highest score wins\\!`,
    { parse_mode: "MarkdownV2" }
  );
}

// ── Instant game resolution ────────────────────────────────────────────────────

async function resolveInstant(bet: UsdtBet, bot: Telegraf<Context>): Promise<void> {
  const VALUES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const card   = () => Math.floor(Math.random() * 13) + 1;
  const gameKey = bet.gameType as GameType;
  const amt     = parseFloat(bet.usdtAmount    as string);
  const fee     = parseFloat(bet.houseFeePercent as string);
  const payout  = payoutAmt(amt, fee);
  const feeAmt  = amt * 2 - payout;

  let cScore = 0, oScore = 0;
  let winnerSide: "creator" | "opponent" | "tie" = "tie";
  let resultLine = "";

  if (gameKey === "coinflip") {
    const flip = Math.random() < 0.5 ? "heads" : "tails";
    resultLine = `🪙 Coin: *${flip}*`;
    cScore = 1; oScore = 0;
    winnerSide = bet.creatorChoice === flip ? "creator" : "opponent";
  } else if (gameKey === "highcard") {
    cScore = card(); oScore = card();
    while (cScore === oScore) { cScore = card(); oScore = card(); }
    resultLine = `🃏 Creator: *${VALUES[cScore-1]}* vs Opponent: *${VALUES[oScore-1]}*`;
    winnerSide = cScore > oScore ? "creator" : "opponent";
  } else if (gameKey === "baccarat") {
    cScore = Math.floor(Math.random() * 10);
    oScore = Math.floor(Math.random() * 10);
    const winSide = cScore >= oScore ? "player" : "banker";
    resultLine = `🀄 Player: *${cScore}* vs Banker: *${oScore}* → *${winSide}*`;
    winnerSide = bet.creatorChoice === winSide ? "creator" : "opponent";
  } else if (gameKey === "dragon") {
    cScore = card(); oScore = cScore;
    const side = cScore >= 7 ? "dragon" : "tiger";
    resultLine = `🐉 Card: *${VALUES[cScore-1]}* → *${side} wins*`;
    winnerSide = bet.creatorChoice === side ? "creator" : "opponent";
  } else if (gameKey === "evenodd") {
    cScore = Math.floor(Math.random() * 6) + 1; oScore = cScore;
    const parity = cScore % 2 === 0 ? "even" : "odd";
    resultLine = `🎲 Roll: *${cScore}* → *${parity}*`;
    winnerSide = bet.creatorChoice === parity ? "creator" : "opponent";
  } else if (gameKey === "lucky7") {
    cScore = card(); oScore = card();
    resultLine = `🔢 Creator: *${VALUES[cScore-1]}* vs Opponent: *${VALUES[oScore-1]}*`;
    winnerSide = Math.abs(7 - cScore) <= Math.abs(7 - oScore) ? "creator" : "opponent";
  } else if (gameKey === "wheel") {
    cScore = Math.floor(Math.random() * 8) + 1;
    oScore = Math.floor(Math.random() * 8) + 1;
    resultLine = `🎡 Creator: *${cScore}* vs Opponent: *${oScore}*`;
    winnerSide = cScore >= oScore ? "creator" : "opponent";
  }

  const winnerId    = winnerSide === "creator" ? bet.creatorId  : winnerSide === "opponent" ? bet.opponentId    : null;
  const winnerUname = winnerSide === "creator" ? bet.creatorUsername : winnerSide === "opponent" ? bet.opponentUsername : null;

  await db.update(usdtBetsTable).set({
    status: "completed", winnerId, creatorScore: cScore, opponentScore: oScore, completedAt: new Date(),
  }).where(eq(usdtBetsTable.id, bet.id));

  const finalBet = (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, bet.id)).limit(1))[0];
  if (finalBet?.betMessageId) {
    try { await bot.telegram.editMessageText(bet.chatId, finalBet.betMessageId, undefined, buildMsg(finalBet), { parse_mode: "MarkdownV2" }); } catch {}
  }

  await sendResultAndPayout(bet, resultLine, winnerId, winnerUname, amt, payout, feeAmt, bot);
}

// ── Dice bet resolution (called after both scores recorded) ───────────────────

async function resolveDiceBet(bet: UsdtBet, bot: Telegraf<Context>): Promise<void> {
  const cS = bet.creatorScore!;
  const oS = bet.opponentScore!;
  const amt    = parseFloat(bet.usdtAmount     as string);
  const fee    = parseFloat(bet.houseFeePercent as string);
  const payout = payoutAmt(amt, fee);
  const feeAmt = amt * 2 - payout;

  let winnerId: number | null = null;
  let winnerUname: string | null = null;

  if (cS > oS)                                 { winnerId = bet.creatorId;  winnerUname = bet.creatorUsername; }
  else if (oS > cS && bet.opponentId)          { winnerId = bet.opponentId!; winnerUname = bet.opponentUsername; }

  await db.update(usdtBetsTable).set({
    status: "completed", winnerId, completedAt: new Date(),
  }).where(eq(usdtBetsTable.id, bet.id));

  const finalBet = (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, bet.id)).limit(1))[0];
  if (finalBet?.betMessageId) {
    try { await bot.telegram.editMessageText(bet.chatId, finalBet.betMessageId, undefined, buildMsg(finalBet), { parse_mode: "MarkdownV2" }); } catch {}
  }

  const resultLine = `🎮 Creator: *${cS}* vs Opponent: *${oS}*`;
  await sendResultAndPayout(bet, resultLine, winnerId, winnerUname, amt, payout, feeAmt, bot);
}

// ── Shared result + payout sender ─────────────────────────────────────────────

async function sendResultAndPayout(
  bet: UsdtBet,
  resultLine: string,
  winnerId: number | null,
  winnerUname: string | null,
  amt: number,
  payout: number,
  feeAmt: number,
  bot: Telegraf<Context>
): Promise<void> {
  let msg = `💎 *USDT Bet \\#${bet.id} — Result\\!*\n\n${resultLine}\n\n`;

  if (winnerId && winnerUname) {
    msg += `🏆 Winner: *@${esc(winnerUname)}*\n`;
    msg += `💰 Payout: *${mv2Usdt(payout)}*\n`;
    msg += `🏦 House fee: ${mv2Usdt(feeAmt)}\n\n`;
    const sent = await sendUsdtPayout(winnerUname, payout, bet.chatId);
    await db.update(usdtBetsTable).set({ payoutSent: sent }).where(eq(usdtBetsTable.id, bet.id));
    if (sent) {
      msg += `✅ _Payout sent via @CWalletBot\\!_`;
    } else {
      const payStr = payout.toFixed(4).replace(/\.?0+$/, "");
      msg += `⚠️ _Admin: send ${mv2Usdt(payout)} to @${esc(winnerUname)}_\n`;
      msg += `\`/tip @${winnerUname} ${payStr} USDT\``;
    }
  } else {
    msg += `🤝 *Tie\\!* Refunding both players\\.`;
    const refundStr = amt.toFixed(4).replace(/\.?0+$/, "");
    if (bet.creatorUsername)  await sendUsdtPayout(bet.creatorUsername,  amt, bet.chatId);
    if (bet.opponentUsername) await sendUsdtPayout(bet.opponentUsername, amt, bet.chatId);
    if (!isUserbotReady()) {
      msg += `\n\n⚠️ _Admin: refund ${mv2Usdt(amt)} to each player_\n`;
      msg += `\`/tip @${bet.creatorUsername}  ${refundStr} USDT\`\n`;
      msg += `\`/tip @${bet.opponentUsername} ${refundStr} USDT\``;
    }
  }
  await bot.telegram.sendMessage(bet.chatId, msg, { parse_mode: "MarkdownV2" });
}

// ── Keyboards ──────────────────────────────────────────────────────────────────

function gameKb(userId: number) {
  const all = Object.entries(GAMES) as [GameType, (typeof GAMES)[GameType]][];
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < all.length; i += 3) {
    rows.push(all.slice(i, i + 3).map(([k, g]) =>
      Markup.button.callback(`${g.emoji} ${g.name}`, `ug_${k}_${userId}`)
    ));
  }
  rows.push([Markup.button.callback("❌ Cancel", `ugcancel_${userId}`)]);
  return Markup.inlineKeyboard(rows);
}

function amtKb(game: GameType, userId: number) {
  const btns = USDT_AMOUNTS.map(a =>
    Markup.button.callback(`${a.toFixed(2)} USDT`, `ua_${Math.round(a * 100)}_${game}_${userId}`)
  );
  return Markup.inlineKeyboard([
    btns,
    [Markup.button.callback("💬 Custom Amount", `ua_custom_${game}_${userId}`)],
    [Markup.button.callback("◀️ Back", `ugback_${userId}`)],
  ]);
}

function choiceKb(game: GameType, betId: number) {
  const opts: Record<string, [string, string][]> = {
    coinflip: [["🪙 Heads", "heads"], ["🪙 Tails", "tails"]],
    baccarat: [["👤 Player", "player"], ["🏦 Banker", "banker"]],
    dragon:   [["🐉 Dragon", "dragon"], ["🐯 Tiger", "tiger"]],
    evenodd:  [["2️⃣ Even", "even"], ["1️⃣ Odd", "odd"]],
  };
  const pairs = opts[game];
  if (!pairs) return null;
  return Markup.inlineKeyboard([pairs.map(([l, v]) => Markup.button.callback(l, `uchoice_${v}_${betId}`))]);
}

function joinKb(betId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💎 Join USDT Bet", `ujoin_${betId}`)],
    [Markup.button.callback("❌ Cancel Bet",     `ucancel_${betId}`)],
  ]);
}

function rpsKb(betId: number) {
  return Markup.inlineKeyboard([[
    Markup.button.callback("🪨 Rock",     `urps_rock_${betId}`),
    Markup.button.callback("📄 Paper",    `urps_paper_${betId}`),
    Markup.button.callback("✂️ Scissors", `urps_scissors_${betId}`),
  ]]);
}

function tipInstr(bet: UsdtBet): string {
  const a = parseFloat(bet.usdtAmount as string).toFixed(4).replace(/\.?0+$/, "");
  return (
    `💳 *Send your payment to activate:*\n\n` +
    `In this chat, send:\n` +
    `\`/tip @${CASINO_ACCOUNT} ${a} USDT\`\n\n` +
    `_I'll detect it automatically\\. Expires in ${USDT_PAYMENT_EXPIRY_MINUTES} min\\._`
  );
}

// ── Register all handlers ──────────────────────────────────────────────────────

export function registerUsdtHandlers(bot: Telegraf<Context>): void {

  // ── /usdt command ────────────────────────────────────────────────────────────

  bot.command("usdt", async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    if (isPrivate(ctx)) {
      return ctx.reply(
        "⚠️ USDT bets require a group chat\\. Add the bot to a group first\\!",
        { parse_mode: "MarkdownV2" }
      );
    }
    if (!canUseUsdt(ctx.from.id)) {
      return ctx.reply("💎 USDT bets are coming soon\\! Stay tuned\\.", { parse_mode: "MarkdownV2" });
    }

    const user = await getOrCreateUser(ctx.from.id, {
      username: ctx.from.username, firstName: ctx.from.first_name,
    });
    if (user.isBanned) return ctx.reply("🚫 You are banned.");
    if (!ctx.from.username) {
      return ctx.reply("⚠️ You need a Telegram *username* \\(@handle\\) to use USDT bets so we can send your winnings\\.", { parse_mode: "MarkdownV2" });
    }

    await ctx.reply(
      "💎 *USDT Bet — Choose a Game*\n\n_Bets are paid via Cwallet TipBot\\. Winnings sent directly to your Cwallet\\._",
      { parse_mode: "MarkdownV2", ...gameKb(ctx.from.id) }
    );
  });

  // ── Game selected ────────────────────────────────────────────────────────────

  bot.action(/^ug_([a-z]+)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const gameKey = ctx.match[1] as GameType;
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your menu.", { show_alert: true });
    if (!canUseUsdt(ctx.from.id)) return ctx.answerCbQuery("🚫 Beta access required.", { show_alert: true });
    if (!GAMES[gameKey]) return ctx.answerCbQuery("❌ Invalid game.", { show_alert: true });
    await ctx.answerCbQuery();
    pendingGame.set(ctx.from.id, { game: gameKey, chatId: ctx.chat.id });
    await safeEdit(ctx,
      `💎 *USDT Bet — ${esc(GAMES[gameKey].name)} ${GAMES[gameKey].emoji}*\n\nChoose your bet amount:`,
      { parse_mode: "MarkdownV2", ...amtKb(gameKey, ctx.from.id) }
    );
  });

  // Cancel game-select menu
  bot.action(/^ugcancel_(\d+)$/, async (ctx) => {
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from?.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your menu.", { show_alert: true });
    await ctx.answerCbQuery("Cancelled.");
    pendingGame.delete(ctx.from.id);
    await safeEdit(ctx, "❌ *USDT bet cancelled\\.*", { parse_mode: "MarkdownV2" });
  });

  // Back to game selector
  bot.action(/^ugback_(\d+)$/, async (ctx) => {
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from?.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your menu.", { show_alert: true });
    await ctx.answerCbQuery();
    await safeEdit(ctx, "💎 *USDT Bet — Choose a Game*", { parse_mode: "MarkdownV2", ...gameKb(ctx.from.id) });
  });

  // ── Amount selected (preset) ─────────────────────────────────────────────────

  bot.action(/^ua_(\d+)_([a-z]+)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const cents   = parseInt(ctx.match[1]);
    const gameKey = ctx.match[2] as GameType;
    const ownerId = parseInt(ctx.match[3]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your menu.", { show_alert: true });
    if (!ctx.from.username) return ctx.answerCbQuery("⚠️ Set a Telegram username first.", { show_alert: true });

    const amount = cents / 100;
    if (amount < USDT_MIN_AMOUNT || amount > USDT_MAX_AMOUNT)
      return ctx.answerCbQuery(`❌ Amount must be ${USDT_MIN_AMOUNT}–${USDT_MAX_AMOUNT} USDT`, { show_alert: true });

    await ctx.answerCbQuery();
    await createUsdtBet(ctx, gameKey, amount);
  });

  // ── Custom amount ────────────────────────────────────────────────────────────

  bot.action(/^ua_custom_([a-z]+)_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const gameKey = ctx.match[1] as GameType;
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your menu.", { show_alert: true });
    if (!ctx.from.username) return ctx.answerCbQuery("⚠️ Set a Telegram username first.", { show_alert: true });
    await ctx.answerCbQuery();
    pendingCustom.set(ctx.from.id, { game: gameKey, chatId: ctx.chat.id });
    await safeEdit(ctx,
      `💬 *Enter your USDT amount:*\n\nType a number \\(e\\.g\\. \`0\\.15\`\\)\nMin: ${mv2Usdt(USDT_MIN_AMOUNT)} • Max: ${mv2Usdt(USDT_MAX_AMOUNT)}`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // ── Creator choice (for binary-side games) ───────────────────────────────────

  bot.action(/^uchoice_([a-z]+)_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const choice = ctx.match[1];
    const betId  = parseInt(ctx.match[2]);
    const [bet]  = await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, betId)).limit(1);
    if (!bet || bet.creatorId !== ctx.from.id) return ctx.answerCbQuery("⚠️ Not your bet.", { show_alert: true });
    if (bet.status !== "awaiting_payment") return ctx.answerCbQuery("❌ Bet already processed.", { show_alert: true });

    await db.update(usdtBetsTable).set({ creatorChoice: choice }).where(eq(usdtBetsTable.id, betId));
    await ctx.answerCbQuery(`✅ Side: ${choice}`);
    const updated = (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, betId)).limit(1))[0];
    await safeEdit(ctx, buildMsg(updated), { parse_mode: "MarkdownV2" });
    await ctx.reply(tipInstr(updated), { parse_mode: "MarkdownV2" });
  });

  // ── Cancel bet ───────────────────────────────────────────────────────────────

  bot.action(/^ucancel_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const betId = parseInt(ctx.match[1]);
    const [bet] = await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, betId)).limit(1);
    if (!bet) return ctx.answerCbQuery("❌ Bet not found.", { show_alert: true });
    if (bet.creatorId !== ctx.from.id && !isAdmin(ctx.from.id))
      return ctx.answerCbQuery("❌ Only the creator can cancel.", { show_alert: true });
    if (!["awaiting_payment", "awaiting_opponent"].includes(bet.status))
      return ctx.answerCbQuery("❌ Cannot cancel this bet.", { show_alert: true });

    await db.update(usdtBetsTable).set({ status: "cancelled" }).where(eq(usdtBetsTable.id, betId));
    await ctx.answerCbQuery("✅ Bet cancelled.");
    await safeEdit(ctx, `❌ *USDT Bet \\#${betId} Cancelled*\n\n_No funds were deducted\\._`, { parse_mode: "MarkdownV2" });
    if (bet.status === "awaiting_payment") {
      await ctx.reply(`_⚠️ Creator: no payment was taken — your Cwallet balance was NOT deducted\\._`, { parse_mode: "MarkdownV2" });
    } else {
      await ctx.reply(`⚠️ _Creator already paid\\. Admin will refund ${mv2Usdt(bet.usdtAmount)} to @${esc(bet.creatorUsername ?? "creator")} manually\\._`, { parse_mode: "MarkdownV2" });
    }
  });

  // ── Opponent join ────────────────────────────────────────────────────────────

  bot.action(/^ujoin_(\d+)$/, async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const betId = parseInt(ctx.match[1]);
    const [bet] = await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, betId)).limit(1);
    if (!bet) return ctx.answerCbQuery("❌ Bet not found.", { show_alert: true });
    if (bet.status !== "awaiting_opponent") return ctx.answerCbQuery("❌ Bet is not open.", { show_alert: true });
    if (bet.creatorId === ctx.from.id) return ctx.answerCbQuery("❌ You created this bet.", { show_alert: true });
    if (bet.opponentId && bet.opponentId !== ctx.from.id) return ctx.answerCbQuery("❌ Someone else already joined.", { show_alert: true });
    if (!ctx.from.username) return ctx.answerCbQuery("⚠️ Set a Telegram @username first.", { show_alert: true });

    // Reserve the opponent slot
    const oppChoice = CHOICE_GAMES.includes(bet.gameType as GameType)
      ? oppositeChoice(bet.gameType as GameType, bet.creatorChoice ?? "")
      : undefined;

    await db.update(usdtBetsTable).set({
      opponentId:       ctx.from.id,
      opponentUsername: ctx.from.username,
      ...(oppChoice ? { opponentChoice: oppChoice } : {}),
    }).where(eq(usdtBetsTable.id, betId));

    const updated = (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, betId)).limit(1))[0];
    if (updated?.betMessageId) {
      try {
        await bot.telegram.editMessageText(bet.chatId, updated.betMessageId, undefined,
          buildMsg(updated), { parse_mode: "MarkdownV2", ...joinKb(betId) }
        );
      } catch {}
    }
    await ctx.answerCbQuery(`✅ Joined! Now send your tip.`);
    const instr = oppChoice
      ? `💎 *You joined as: ${oppChoice}*\n\n${tipInstr(updated)}`
      : tipInstr(updated);
    await ctx.reply(instr, { parse_mode: "MarkdownV2" });
    pendingJoin.set(ctx.from.id, betId);
  });

  // ── RPS moves ────────────────────────────────────────────────────────────────

  bot.action(/^urps_(rock|paper|scissors)_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const move  = ctx.match[1];
    const betId = parseInt(ctx.match[2]);
    const [bet] = await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, betId)).limit(1);
    if (!bet || bet.status !== "active" || bet.gameType !== "rps")
      return ctx.answerCbQuery("❌ Invalid.", { show_alert: true });

    const isCreator  = bet.creatorId  === ctx.from.id;
    const isOpponent = bet.opponentId === ctx.from.id;
    if (!isCreator && !isOpponent) return ctx.answerCbQuery("⚠️ You're not in this bet.", { show_alert: true });

    let choices = rpsChoices.get(betId) ?? {};
    if (isCreator)  { if (choices.creator)  return ctx.answerCbQuery("Already picked.", { show_alert: true }); choices = { ...choices, creator: move }; }
    if (isOpponent) { if (choices.opponent) return ctx.answerCbQuery("Already picked.", { show_alert: true }); choices = { ...choices, opponent: move }; }
    rpsChoices.set(betId, choices);

    await ctx.answerCbQuery(`✅ ${move} locked in!`);

    if (choices.creator && choices.opponent) {
      rpsChoices.delete(betId);
      const WINS: Record<string, string> = { rock: "scissors", paper: "rock", scissors: "paper" };
      let winnerSide: "creator" | "opponent" | "tie" = "tie";
      if (WINS[choices.creator] === choices.opponent)        winnerSide = "creator";
      else if (WINS[choices.opponent] === choices.creator)   winnerSide = "opponent";

      const winnerId    = winnerSide === "creator" ? bet.creatorId : winnerSide === "opponent" ? bet.opponentId : null;
      const winnerUname = winnerSide === "creator" ? bet.creatorUsername : winnerSide === "opponent" ? bet.opponentUsername : null;
      const amt         = parseFloat(bet.usdtAmount as string);
      const payout      = payoutAmt(amt, bet.houseFeePercent as string);

      await db.update(usdtBetsTable).set({
        status: "completed", winnerId,
        creatorChoice: choices.creator, opponentChoice: choices.opponent,
        completedAt: new Date(),
      }).where(eq(usdtBetsTable.id, betId));

      const finalBet = (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, betId)).limit(1))[0];
      if (finalBet?.betMessageId) {
        try { await bot.telegram.editMessageText(bet.chatId, finalBet.betMessageId, undefined, buildMsg(finalBet), { parse_mode: "MarkdownV2" }); } catch {}
      }

      const resultLine = `🤜 Creator: *${choices.creator}* vs Opponent: *${choices.opponent}*`;
      await sendResultAndPayout(bet, resultLine, winnerId, winnerUname, amt, payout, amt * 2 - payout, bot);
    } else {
      await ctx.reply(`✅ Move locked\\. Waiting for the other player\\.`, { parse_mode: "MarkdownV2" });
    }
  });

  // ── @CWalletBot message detection ────────────────────────────────────────────

  bot.on("message", async (ctx, next) => {
    const msg = ctx.message as Message.TextMessage;
    if (!msg?.text || !ctx.from || !ctx.chat) return next();

    // Only process messages from @CWalletBot (or configured bot username)
    const senderUsername = ctx.from.username?.toLowerCase();
    if (senderUsername !== CWALLET_BOT.toLowerCase()) {
      // Also handle custom amount input
      if (pendingCustom.has(ctx.from.id)) {
        const { game, chatId } = pendingCustom.get(ctx.from.id)!;
        if (ctx.chat.id !== chatId) return next();
        const val = parseFloat(msg.text.trim());
        if (isNaN(val) || val < USDT_MIN_AMOUNT || val > USDT_MAX_AMOUNT) {
          await ctx.reply(`❌ Invalid amount\\. Enter a number between ${mv2Usdt(USDT_MIN_AMOUNT)} and ${mv2Usdt(USDT_MAX_AMOUNT)}`, { parse_mode: "MarkdownV2" });
          return next();
        }
        pendingCustom.delete(ctx.from.id);
        await createUsdtBet(ctx, game, val);
        return next();
      }
      return next();
    }

    // Parse tip confirmation
    const tip = parseTip(msg.text);
    if (tip) {
      await handleTipDetected(tip.fromUsername, tip.amount, ctx.chat.id, bot);
    }
    return next();
  });

  // ── Dice rolls for active USDT bets ──────────────────────────────────────────

  bot.on("message", async (ctx, next) => {
    const msg = ctx.message as Message.DiceMessage;
    if (!msg?.dice || !ctx.from || !ctx.chat) return next();

    const emoji   = msg.dice.emoji;
    const score   = msg.dice.value;
    const gameKey = EMOJI_TO_GAME[emoji];
    if (!gameKey || !DICE_GAMES.includes(gameKey)) return next();

    // Find active USDT dice bet for this player in this chat
    const activeBets = await db.select().from(usdtBetsTable).where(
      and(eq(usdtBetsTable.chatId, ctx.chat.id), eq(usdtBetsTable.status, "active"))
    );
    const playerBet = activeBets.find(b =>
      b.gameType === gameKey &&
      (b.creatorId === ctx.from!.id || b.opponentId === ctx.from!.id)
    );
    if (!playerBet) return next();

    const isCreator = playerBet.creatorId === ctx.from.id;
    if (isCreator  && playerBet.creatorScore  !== null) { await ctx.reply("⚠️ You already rolled\\!", { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }); return next(); }
    if (!isCreator && playerBet.opponentScore !== null) { await ctx.reply("⚠️ You already rolled\\!", { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id }); return next(); }

    if (isCreator)  await db.update(usdtBetsTable).set({ creatorScore:  score }).where(eq(usdtBetsTable.id, playerBet.id));
    else            await db.update(usdtBetsTable).set({ opponentScore: score }).where(eq(usdtBetsTable.id, playerBet.id));

    const updated = (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, playerBet.id)).limit(1))[0];
    if (!updated) return next();

    if (updated.creatorScore !== null && updated.opponentScore !== null) {
      await resolveDiceBet(updated, bot);
    } else {
      const waitFor = isCreator ? "your opponent" : "the bet creator";
      await ctx.reply(`✅ Score: *${score}* recorded — waiting for ${waitFor} to roll\\.`, { parse_mode: "MarkdownV2", reply_to_message_id: msg.message_id });
    }
    return next();
  });
}

// ── Bet creation helper ────────────────────────────────────────────────────────

async function createUsdtBet(ctx: Context, gameKey: GameType, amount: number): Promise<void> {
  if (!ctx.from || !ctx.chat || !ctx.from.username) return;

  const expiry = new Date(Date.now() + USDT_PAYMENT_EXPIRY_MINUTES * 60_000);
  const [bet] = await db.insert(usdtBetsTable).values({
    chatId:          ctx.chat.id,
    gameType:        gameKey,
    creatorId:       ctx.from.id,
    creatorUsername: ctx.from.username,
    usdtAmount:      amount.toFixed(4),
    houseFeePercent: USDT_HOUSE_FEE_PERCENT.toString(),
    status:          "awaiting_payment",
    expiresAt:       expiry,
  } as any).returning();

  // For choice games, ask the creator to pick their side
  if (CHOICE_GAMES.includes(gameKey)) {
    const betWithMsg = await sendBetMessage(ctx, bet);
    const kb = choiceKb(gameKey, bet.id);
    if (kb) {
      await ctx.reply(
        `🎯 *Choose your side for ${esc(GAMES[gameKey].name)}:*`,
        { parse_mode: "MarkdownV2", ...kb }
      );
    } else {
      await ctx.reply(tipInstr(betWithMsg ?? bet), { parse_mode: "MarkdownV2" });
    }
  } else {
    const betWithMsg = await sendBetMessage(ctx, bet);
    await ctx.reply(tipInstr(betWithMsg ?? bet), { parse_mode: "MarkdownV2" });
  }
}

async function sendBetMessage(ctx: Context, bet: UsdtBet): Promise<UsdtBet | null> {
  try {
    const sentMsg = await ctx.reply(buildMsg(bet), {
      parse_mode: "MarkdownV2",
      ...joinKb(bet.id),
    });
    await db.update(usdtBetsTable)
      .set({ betMessageId: sentMsg.message_id })
      .where(eq(usdtBetsTable.id, bet.id));
    return (await db.select().from(usdtBetsTable).where(eq(usdtBetsTable.id, bet.id)).limit(1))[0] ?? null;
  } catch {
    return null;
  }
}
