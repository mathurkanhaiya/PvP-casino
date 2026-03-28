import { Telegraf, Context } from "telegraf";
import { getOrCreateUser, getUserByTelegramId, getUserTransactions } from "../db.js";
import { walletMessage } from "../messages.js";
import { backToMenuKeyboard } from "../keyboards.js";

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

export function registerWalletHandlers(bot: Telegraf<Context>) {
  bot.command("wallet", async (ctx) => {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    const txs = await getUserTransactions(ctx.from.id, 15);
    await ctx.reply(walletMessage(user, txs), {
      parse_mode: "MarkdownV2",
      ...backToMenuKeyboard(ctx.from.id),
    });
  });

  // wallet_{userId} — from dashboard button
  bot.action(/^wallet_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /wallet to see your own transactions.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    const user = await getUserByTelegramId(ctx.from.id);
    if (!user) return;
    const txs = await getUserTransactions(ctx.from.id, 15);
    await safeEdit(ctx, walletMessage(user, txs), {
      parse_mode: "MarkdownV2",
      ...backToMenuKeyboard(ctx.from.id),
    });
  });
}
