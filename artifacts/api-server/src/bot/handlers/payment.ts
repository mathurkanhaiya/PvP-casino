import { Telegraf, Context, Markup } from "telegraf";
import { getUserByTelegramId, updateBalance } from "../db.js";
import { mv2Num } from "../messages.js";
import { depositMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { COINS_PER_STAR, MIN_DEPOSIT_STARS } from "../config.js";
import { db } from "@workspace/db";
import { depositsTable } from "@workspace/db/schema";

// Pending custom deposit amounts (userId → stars)
const pendingDeposit = new Map<number, "awaiting_amount">();

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

function depositInfoText() {
  return `
💳 *Deposit with Telegram Stars*

*Rate:* ⭐ 1 Star \\= ${mv2Num(COINS_PER_STAR)}
*Minimum:* 1 Star \\= ${mv2Num(COINS_PER_STAR)}

*Quick tiers:*
⭐ 1 Star → ${mv2Num(500)}
⭐ 10 Stars → ${mv2Num(5_000)}
⭐ 50 Stars → ${mv2Num(25_000)}
⭐ 100 Stars → ${mv2Num(50_000)}

Or tap *Custom Amount* to enter any number of stars\\.

_Stars are Telegram's premium currency\\. Tap any button to open the secure payment form\\._
`.trim();
}

/** Build and send a Stars invoice for the given number of stars */
async function sendDepositInvoice(ctx: Context, userId: number, stars: number) {
  const coins = stars * COINS_PER_STAR;
  await ctx.replyWithInvoice({
    title: `🎰 Deposit — ${stars} Star${stars > 1 ? "s" : ""}`,
    description: `Receive ${coins.toLocaleString()} casino coins instantly. Rate: 1 Star = ${COINS_PER_STAR} coins.`,
    payload: JSON.stringify({ type: "deposit", userId, stars }),
    currency: "XTR",
    prices: [{ label: `${coins.toLocaleString()} Casino Coins`, amount: stars }],
  });
}

export function registerPaymentHandlers(bot: Telegraf<Context>) {

  // ── DEPOSIT ──────────────────────────────────────────────────────────────

  // /deposit           → show menu
  // /deposit 5         → invoice for 5 stars immediately
  bot.command("deposit", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUserByTelegramId(ctx.from.id);
    if (user?.isBanned) return ctx.reply("🚫 You are banned.");

    const arg = ctx.message.text.split(" ").slice(1).join("").trim();
    if (arg) {
      const stars = parseInt(arg);
      if (isNaN(stars) || stars < MIN_DEPOSIT_STARS || stars > 10_000) {
        return ctx.reply(`❌ Enter a number between ${MIN_DEPOSIT_STARS} and 10,000 stars\\.`, { parse_mode: "MarkdownV2" });
      }
      return sendDepositInvoice(ctx, ctx.from.id, stars);
    }

    await ctx.reply(depositInfoText(), { parse_mode: "MarkdownV2", ...depositMenuKeyboard(ctx.from.id) });
  });

  // Deposit menu button (from dashboard)
  bot.action(/^deposit_menu_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /deposit for your own wallet.", { show_alert: true });
    await ctx.answerCbQuery();
    await safeEdit(ctx, depositInfoText(), { parse_mode: "MarkdownV2", ...depositMenuKeyboard(ctx.from.id) });
  });

  // Quick preset tiers: deposit_{stars}stars_{userId}
  bot.action(/^deposit_(\d+)stars_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const stars = parseInt(ctx.match[1]);
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your wallet.", { show_alert: true });
    if (stars < MIN_DEPOSIT_STARS || stars > 10_000) return ctx.answerCbQuery("❌ Invalid amount", { show_alert: true });
    await ctx.answerCbQuery();
    await sendDepositInvoice(ctx, ctx.from.id, stars);
  });

  // Custom amount: deposit_custom_{userId}
  bot.action(/^deposit_custom_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your wallet.", { show_alert: true });
    await ctx.answerCbQuery();
    pendingDeposit.set(ctx.from.id, "awaiting_amount");
    await safeEdit(ctx,
      `✏️ *Custom Deposit*\n\nHow many stars do you want to deposit?\n\n*Rate:* ⭐ 1 Star \\= ${mv2Num(COINS_PER_STAR)}\n*Min:* 1 star \\| *Max:* 10,000 stars\n\nType the number of stars below:`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // Approve Stars payment
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  // Successful payment → credit coins
  bot.on("message", async (ctx, next) => {
    const msg = ctx.message as any;

    // Handle custom deposit text input
    if (msg.text && !msg.text.startsWith("/") && ctx.from && pendingDeposit.has(ctx.from.id)) {
      pendingDeposit.delete(ctx.from.id);
      const stars = parseInt(msg.text.trim());
      if (isNaN(stars) || stars < MIN_DEPOSIT_STARS || stars > 10_000) {
        await ctx.reply(`❌ Enter a whole number between ${MIN_DEPOSIT_STARS} and 10,000\\.`, { parse_mode: "MarkdownV2" });
        return next();
      }
      await sendDepositInvoice(ctx, ctx.from.id, stars);
      return next();
    }

    // Successful Stars payment
    if (!msg?.successful_payment || !ctx.from) return next();
    const payment = msg.successful_payment;
    if (payment.currency !== "XTR") return next();

    let payload: any;
    try { payload = JSON.parse(payment.invoice_payload); } catch { return next(); }
    if (payload.type !== "deposit" || payload.userId !== ctx.from.id) return next();

    const stars = payload.stars as number;
    const coins = stars * COINS_PER_STAR;

    await updateBalance(ctx.from.id, coins, "deposit", `Deposited ${stars}★`, undefined);

    await db.insert(depositsTable).values({
      userId: ctx.from.id,
      stars,
      coinsAwarded: coins.toString(),
      telegramChargeId: payment.telegram_payment_charge_id,
    } as any);

    const user = await getUserByTelegramId(ctx.from.id);
    await ctx.reply(
      `✅ *Deposit Successful\\!*\n\n` +
      `⭐ *${stars} Star${stars > 1 ? "s" : ""}* → 🪙 *${coins.toLocaleString()} coins*\n` +
      `💰 New Balance: ${mv2Num(user?.balance ?? 0)}\n\n` +
      `_Charge ID \\(save for refunds\\):_\n\`${payment.telegram_payment_charge_id}\``,
      { parse_mode: "MarkdownV2", ...backToMenuKeyboard(ctx.from.id) }
    );
    return next();
  });

}
