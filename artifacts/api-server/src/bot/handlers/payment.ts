import { Telegraf, Context, Markup } from "telegraf";
import { getUserByTelegramId, updateBalance } from "../db.js";
import { formatBalance } from "../messages.js";
import { depositMenuKeyboard, withdrawMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { esc } from "../escape.js";
import { db } from "@workspace/db";
import { usersTable, depositsTable, withdrawRequestsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

// ── Rates ────────────────────────────────────────────────────────────────────
const COINS_PER_STAR = 100;    // Deposit:  1 ★ = 100 coins
const WITHDRAW_COINS = 5_000;  // Withdraw: 5,000 coins = 15 ★
const WITHDRAW_STARS = 15;

const DEPOSIT_TIERS = [
  { stars: 10,  coins: 1_000  },
  { stars: 50,  coins: 5_000  },
  { stars: 100, coins: 10_000 },
  { stars: 500, coins: 50_000 },
];
const WITHDRAW_TIERS = [
  { coins: 5_000,  stars: 15  },
  { coins: 15_000, stars: 45  },
  { coins: 50_000, stars: 150 },
];

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
  const tiers = DEPOSIT_TIERS
    .map(t => `⭐ *${t.stars} Stars* → ${formatBalance(t.coins)}`)
    .join("\n");
  return `
💳 *Deposit with Telegram Stars*

*Rate:* ⭐ 1 Star \\= ${formatBalance(COINS_PER_STAR)}

${tiers}

_Stars are Telegram's premium currency\\._
_Tap a button below to open the secure payment form\\._
`.trim();
}

function withdrawInfoText(balance: string | number) {
  const bal = parseFloat(balance as string);
  const tiers = WITHDRAW_TIERS.map(t => {
    const available = bal >= t.coins;
    const icon = available ? "✅" : "🔒";
    return `${icon} ${formatBalance(t.coins)} → ⭐ *${t.stars} Stars*`;
  }).join("\n");

  return `
💸 *Withdraw — Coins → Telegram Stars*

*Rate:* ${formatBalance(WITHDRAW_COINS)} \\= ⭐ ${WITHDRAW_STARS} Stars
*Your Balance:* ${formatBalance(balance)}

*Tiers:*
${tiers}

_Coins are deducted immediately\\._
_Stars sent as Telegram Gift within 24 hours\\._
`.trim();
}

export function registerPaymentHandlers(bot: Telegraf<Context>) {

  // ── DEPOSIT ────────────────────────────────────────────────────────────────

  bot.command("deposit", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUserByTelegramId(ctx.from.id);
    if (user?.isBanned) return ctx.reply("🚫 You are banned.");
    await ctx.reply(depositInfoText(), { parse_mode: "MarkdownV2", ...depositMenuKeyboard(ctx.from.id) });
  });

  bot.action(/^deposit_menu_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Use /deposit for your own wallet.", { show_alert: true });
    await ctx.answerCbQuery();
    await safeEdit(ctx, depositInfoText(), { parse_mode: "MarkdownV2", ...depositMenuKeyboard(ctx.from.id) });
  });

  // Tap a deposit tier → send invoice
  bot.action(/^deposit_(\d+)stars_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const stars = parseInt(ctx.match[1]);
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your wallet.", { show_alert: true });
    await ctx.answerCbQuery();

    const tier = DEPOSIT_TIERS.find(t => t.stars === stars);
    if (!tier) return;

    await ctx.replyWithInvoice({
      title: `🎰 Casino Deposit — ${stars} Stars`,
      description: `Instantly receive ${tier.coins.toLocaleString()} casino coins. Rate: 1 Star = ${COINS_PER_STAR} coins.`,
      payload: JSON.stringify({ type: "deposit", userId: ctx.from.id, stars }),
      currency: "XTR",
      prices: [{ label: `${tier.coins.toLocaleString()} Casino Coins`, amount: stars }],
    });
  });

  // Approve all Star payment invoices
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  // Successful payment → credit coins
  bot.on("message", async (ctx, next) => {
    const msg = ctx.message as any;
    if (!msg?.successful_payment || !ctx.from) return next();

    const payment = msg.successful_payment;
    if (payment.currency !== "XTR") return next();

    let payload: any;
    try { payload = JSON.parse(payment.invoice_payload); } catch { return next(); }
    if (payload.type !== "deposit" || payload.userId !== ctx.from.id) return next();

    const stars = payload.stars as number;
    const coins = stars * COINS_PER_STAR;

    await updateBalance(ctx.from.id, coins, "deposit", `Deposited ${stars}★`, undefined);

    // Log deposit
    await db.insert(depositsTable).values({
      userId: ctx.from.id,
      stars,
      coinsAwarded: coins.toString(),
      telegramChargeId: payment.telegram_payment_charge_id,
    } as any);

    const user = await getUserByTelegramId(ctx.from.id);
    await ctx.reply(
      `✅ *Deposit Successful\\!*\n\n⭐ *${stars} Stars* received\n\\+${formatBalance(coins)} credited to your balance\n💰 New Balance: ${formatBalance(user?.balance ?? 0)}\n\nGood luck at the casino\\! 🎰`,
      { parse_mode: "MarkdownV2", ...backToMenuKeyboard(ctx.from.id) }
    );

    return next();
  });

  // ── WITHDRAW ───────────────────────────────────────────────────────────────

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

  // Tap a withdraw tier → deduct coins, create request
  bot.action(/^withdraw_(\d+)coins_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const coins = parseInt(ctx.match[1]);
    const ownerId = parseInt(ctx.match[2]);
    if (ctx.from.id !== ownerId) return ctx.answerCbQuery("⚠️ Not your wallet.", { show_alert: true });

    const tier = WITHDRAW_TIERS.find(t => t.coins === coins);
    if (!tier) return ctx.answerCbQuery("❌ Invalid amount", { show_alert: true });

    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;

    if (parseFloat(user.balance as string) < tier.coins) {
      return ctx.answerCbQuery(
        `❌ Need ${tier.coins.toLocaleString()} coins, you only have ${Math.floor(parseFloat(user.balance as string)).toLocaleString()}.`,
        { show_alert: true }
      );
    }

    await ctx.answerCbQuery("✅ Withdraw request submitted!");
    await updateBalance(ctx.from.id, -tier.coins, "withdraw_request", `Withdraw ${tier.stars}★`, undefined);

    const [request] = await db.insert(withdrawRequestsTable).values({
      userId: ctx.from.id,
      coinsDeducted: tier.coins.toString(),
      starsRequested: tier.stars,
      status: "pending",
    } as any).returning();

    const updatedUser = await getUserByTelegramId(ctx.from.id);

    await safeEdit(ctx,
      `⏳ *Withdraw Request \\#${request.id} Submitted\\!*\n\n💸 Coins deducted: ${formatBalance(tier.coins)}\n⭐ Stars to receive: *${tier.stars} Stars*\n💰 Remaining Balance: ${formatBalance(updatedUser?.balance ?? 0)}\n\n_Processed within 24 hours — stars sent as Telegram Gift\\._`,
      { parse_mode: "MarkdownV2", ...backToMenuKeyboard(ctx.from.id) }
    );

    // Ping admins
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",").map(Number) : [];
    const userName = user.username ? `@${user.username}` : (user.firstName || `User#${user.telegramId}`);
    for (const adminId of adminIds) {
      try {
        await ctx.telegram.sendMessage(adminId,
          `💸 *Withdrawal Request \\#${request.id}*\n\n👤 ${esc(userName)} \\(\`${user.telegramId}\`\\)\n💰 ${formatBalance(tier.coins)}\n⭐ ${tier.stars} Stars\n\n/adminpanel → Withdrawal Requests`,
          { parse_mode: "MarkdownV2" }
        );
      } catch {}
    }
  });

  // ── ADMIN: view & process withdrawals ─────────────────────────────────────

  bot.action("admin_withdrawals", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",").map(Number) : [];
    const me = await getUserByTelegramId(ctx.from.id);
    if (!me?.isAdmin && !adminIds.includes(ctx.from.id)) {
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    }

    const requests = await db.select().from(withdrawRequestsTable)
      .where(eq(withdrawRequestsTable.status, "pending"))
      .orderBy(desc(withdrawRequestsTable.createdAt))
      .limit(10);

    if (requests.length === 0) {
      return safeEdit(ctx, "✅ *No pending withdrawal requests\\.*", {
        parse_mode: "MarkdownV2",
        ...backToAdminKb(),
      });
    }

    const rows = requests.map(r =>
      `*\\#${r.id}* — \`${r.userId}\` — ${formatBalance(r.coinsDeducted)} → ⭐ ${r.starsRequested}★`
    ).join("\n");

    const buttons = [
      ...requests.map(r => [
        Markup.button.callback(`✅ #${r.id}`, `wd_approve_${r.id}`),
        Markup.button.callback(`❌ #${r.id}`, `wd_reject_${r.id}`),
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
    if (!req || req.status !== "pending") return ctx.answerCbQuery("❌ Not found or already processed", { show_alert: true });

    await db.update(withdrawRequestsTable).set({ status: "approved", processedAt: new Date() } as any).where(eq(withdrawRequestsTable.id, reqId));
    await ctx.answerCbQuery(`✅ Approved — send ${req.starsRequested} stars to user ${req.userId}`);

    try {
      await ctx.telegram.sendMessage(req.userId,
        `🎉 *Withdrawal \\#${reqId} Approved\\!*\n\n⭐ *${req.starsRequested} Stars* will be sent as a Telegram Gift shortly\\!\n\n_Thank you for playing\\!_ 🎰`,
        { parse_mode: "MarkdownV2" }
      );
    } catch {}

    await safeEdit(ctx,
      `✅ *Request \\#${reqId} approved\\.*\nManually send *${req.starsRequested} Stars* to \`${req.userId}\`\\.`,
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
    if (!req || req.status !== "pending") return ctx.answerCbQuery("❌ Not found or already processed", { show_alert: true });

    await updateBalance(req.userId, parseFloat(req.coinsDeducted as string), "withdraw_refund", `Withdrawal #${reqId} rejected — refund`, undefined);
    await db.update(withdrawRequestsTable).set({ status: "rejected", processedAt: new Date() } as any).where(eq(withdrawRequestsTable.id, reqId));
    await ctx.answerCbQuery("❌ Rejected — coins refunded to user.");

    try {
      await ctx.telegram.sendMessage(req.userId,
        `❌ *Withdrawal \\#${reqId} Rejected*\n\n${formatBalance(req.coinsDeducted)} has been refunded to your balance\\.\n\nContact an admin if you have questions\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch {}

    await safeEdit(ctx,
      `❌ *Request \\#${reqId} rejected\\. Coins refunded to user \\(\`${req.userId}\`\\)\\.*`,
      { parse_mode: "MarkdownV2", ...backToAdminKb() }
    );
  });
}
