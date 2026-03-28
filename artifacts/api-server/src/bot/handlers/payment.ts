import { Telegraf, Context, Markup } from "telegraf";
import { getUserByTelegramId, updateBalance } from "../db.js";
import { formatBalance, mv2Num } from "../messages.js";
import { depositMenuKeyboard, withdrawMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { esc } from "../escape.js";
import { COINS_PER_STAR, MIN_DEPOSIT_STARS, WITHDRAW_TIERS } from "../config.js";
import { db } from "@workspace/db";
import { depositsTable, withdrawRequestsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

// Pending custom deposit amounts (userId → stars)
const pendingDeposit = new Map<number, "awaiting_amount">();

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

function backToAdminKb() {
  return Markup.inlineKeyboard([[Markup.button.callback("◀️ Back to Admin", "admin_panel")]]);
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

function withdrawInfoText(balance: string | number) {
  const bal = parseFloat(balance as string);
  const rows = WITHDRAW_TIERS.map(t => {
    const ok = bal >= t.coins;
    return `${ok ? "✅" : "🔒"} ${mv2Num(t.coins)} → ⭐ *${t.stars} Stars*\n   _Gift: ${t.label}_`;
  }).join("\n\n");

  return `
💸 *Withdraw — Coins → Telegram Star Gift*

*Your Balance:* ${mv2Num(bal)}

${rows}

_Coins deducted immediately\\. Gift sent within 24 hours\\._
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
      `✅ *Deposit Successful\\!*\n\n⭐ *${stars} Star${stars > 1 ? "s" : ""}* received\n\\+${mv2Num(coins)} credited instantly\n💰 New Balance: ${mv2Num(user?.balance ?? 0)}\n\nGood luck at the casino\\! 🎰`,
      { parse_mode: "MarkdownV2", ...backToMenuKeyboard(ctx.from.id) }
    );
    return next();
  });

  // ── WITHDRAW ─────────────────────────────────────────────────────────────

  bot.command("withdraw", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;
    if (user.isBanned) return ctx.reply("🚫 You are banned.");
    await ctx.reply(withdrawInfoText(user.balance), {
      parse_mode: "MarkdownV2",
      ...withdrawMenuKeyboard(user.balance, ctx.from.id),
    });
  });

  bot.action(/^withdraw_menu_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /withdraw for your own wallet.", { show_alert: true });
    await ctx.answerCbQuery();
    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;
    await safeEdit(ctx, withdrawInfoText(user.balance), {
      parse_mode: "MarkdownV2",
      ...withdrawMenuKeyboard(user.balance, ctx.from.id),
    });
  });

  // withdraw_{coins}coins_{userId}
  bot.action(/^withdraw_(\d+)coins_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const coins = parseInt(ctx.match[1]);
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your wallet.", { show_alert: true });

    const tier = WITHDRAW_TIERS.find(t => t.coins === coins);
    if (!tier) return ctx.answerCbQuery("❌ Invalid tier", { show_alert: true });

    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;
    if (parseFloat(user.balance as string) < tier.coins) {
      return ctx.answerCbQuery(
        `❌ Need ${tier.coins.toLocaleString()} coins — you have ${Math.floor(parseFloat(user.balance as string)).toLocaleString()}.`,
        { show_alert: true }
      );
    }

    await ctx.answerCbQuery("✅ Request submitted!");
    await updateBalance(ctx.from.id, -tier.coins, "withdraw_request", `Withdraw ${tier.stars}★ (${tier.label})`, undefined);

    const [request] = await db.insert(withdrawRequestsTable).values({
      userId: ctx.from.id,
      coinsDeducted: tier.coins.toString(),
      starsRequested: tier.stars,
      adminNote: tier.label,   // store which gift to send
      status: "pending",
    } as any).returning();

    const updated = await getUserByTelegramId(ctx.from.id);

    await safeEdit(ctx,
      `⏳ *Withdrawal \\#${request.id} Submitted\\!*\n\n💸 Coins deducted: ${mv2Num(tier.coins)}\n⭐ Stars: *${tier.stars}*\n🎁 Gift type: *${tier.label}*\n💰 Remaining: ${mv2Num(updated?.balance ?? 0)}\n\n_Gift will be sent within 24 hours\\._`,
      { parse_mode: "MarkdownV2", ...backToMenuKeyboard(ctx.from.id) }
    );

    // Notify admins
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",").map(Number) : [];
    const userName = user.username ? `@${user.username}` : (user.firstName || `User#${user.telegramId}`);
    for (const adminId of adminIds) {
      try {
        await ctx.telegram.sendMessage(adminId,
          `💸 *Withdrawal Request \\#${request.id}*\n\n👤 ${esc(userName)} \\(\`${user.telegramId}\`\\)\n💰 ${mv2Num(tier.coins)}\n⭐ ${tier.stars} Stars\n🎁 Gift: *${tier.label}*\n\n/adminpanel → Withdrawal Requests`,
          { parse_mode: "MarkdownV2" }
        );
      } catch {}
    }
  });

  // ── ADMIN: withdraw panel ─────────────────────────────────────────────────

  bot.action("admin_withdrawals", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",").map(Number) : [];
    const me = await getUserByTelegramId(ctx.from.id);
    if (!me?.isAdmin && !adminIds.includes(ctx.from.id)) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const requests = await db.select().from(withdrawRequestsTable)
      .where(eq(withdrawRequestsTable.status, "pending"))
      .orderBy(desc(withdrawRequestsTable.createdAt))
      .limit(10);

    if (requests.length === 0) {
      return safeEdit(ctx, "✅ *No pending withdrawal requests\\.*", { parse_mode: "MarkdownV2", ...backToAdminKb() });
    }

    const rows = requests.map(r => {
      const giftInfo = r.adminNote ? ` — 🎁 ${esc(r.adminNote)}` : "";
      return `*\\#${r.id}* · \`${r.userId}\` · ${mv2Num(r.coinsDeducted)} → ⭐${r.starsRequested}★${giftInfo}`;
    }).join("\n");

    const buttons = [
      ...requests.map(r => [
        Markup.button.callback(`✅ Approve #${r.id}`, `wd_approve_${r.id}`),
        Markup.button.callback(`❌ Reject #${r.id}`,  `wd_reject_${r.id}`),
      ]),
      [Markup.button.callback("◀️ Back to Admin", "admin_panel")],
    ];

    await safeEdit(ctx, `💸 *Pending Withdrawals:*\n\n${rows}`, {
      parse_mode: "MarkdownV2",
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // Approve
  bot.action(/^wd_approve_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",").map(Number) : [];
    const me = await getUserByTelegramId(ctx.from.id);
    if (!me?.isAdmin && !adminIds.includes(ctx.from.id)) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const reqId = parseInt(ctx.match[1]);
    const [req] = await db.select().from(withdrawRequestsTable).where(eq(withdrawRequestsTable.id, reqId)).limit(1);
    if (!req || req.status !== "pending") return ctx.answerCbQuery("❌ Already processed", { show_alert: true });

    await db.update(withdrawRequestsTable)
      .set({ status: "approved", processedAt: new Date() } as any)
      .where(eq(withdrawRequestsTable.id, reqId));

    await ctx.answerCbQuery(`✅ Approved — send ${req.starsRequested}★ gift to user ${req.userId}`);

    // Attempt to send gift automatically via Telegram API (if gift IDs are configured)
    // Since gift IDs are dynamic, we notify user and admin handles manually
    try {
      const giftNote = req.adminNote ? ` as *${esc(req.adminNote as string)}*` : "";
      await ctx.telegram.sendMessage(req.userId,
        `🎉 *Withdrawal \\#${reqId} Approved\\!*\n\n⭐ *${req.starsRequested} Stars*${giftNote} will be sent to your Telegram account within a few minutes\\!\n\n_Thank you for playing\\! 🎰_`,
        { parse_mode: "MarkdownV2" }
      );
    } catch {}

    const giftInstruction = req.adminNote
      ? `\n\n📋 *Send this gift to user:*\n🎁 ${esc(req.adminNote as string)}\n👤 User ID: \`${req.userId}\``
      : "";

    await safeEdit(ctx,
      `✅ *Request \\#${reqId} Approved\\.*${giftInstruction}\n\n_Open Telegram → Search user → Send Gift_`,
      { parse_mode: "MarkdownV2", ...backToAdminKb() }
    );
  });

  // Reject → refund
  bot.action(/^wd_reject_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",").map(Number) : [];
    const me = await getUserByTelegramId(ctx.from.id);
    if (!me?.isAdmin && !adminIds.includes(ctx.from.id)) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const reqId = parseInt(ctx.match[1]);
    const [req] = await db.select().from(withdrawRequestsTable).where(eq(withdrawRequestsTable.id, reqId)).limit(1);
    if (!req || req.status !== "pending") return ctx.answerCbQuery("❌ Already processed", { show_alert: true });

    await updateBalance(req.userId, parseFloat(req.coinsDeducted as string), "withdraw_refund", `Withdrawal #${reqId} rejected — refund`, undefined);
    await db.update(withdrawRequestsTable)
      .set({ status: "rejected", processedAt: new Date() } as any)
      .where(eq(withdrawRequestsTable.id, reqId));

    await ctx.answerCbQuery("❌ Rejected — coins refunded.");

    try {
      await ctx.telegram.sendMessage(req.userId,
        `❌ *Withdrawal \\#${reqId} Rejected*\n\n${mv2Num(req.coinsDeducted)} has been refunded to your balance\\.\n\nContact an admin if you have questions\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch {}

    await safeEdit(ctx,
      `❌ *Request \\#${reqId} rejected\\. Coins refunded to \`${req.userId}\`\\.*`,
      { parse_mode: "MarkdownV2", ...backToAdminKb() }
    );
  });
}
