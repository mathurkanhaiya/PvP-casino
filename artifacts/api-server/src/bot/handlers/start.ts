import { Telegraf, Context } from "telegraf";
import { getOrCreateUser } from "../db.js";
import { welcomeMessage, helpMessage } from "../messages.js";
import { mainMenuKeyboard } from "../keyboards.js";

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

export function registerStartHandlers(bot: Telegraf<Context>) {
  bot.start(async (ctx) => {
    if (!ctx.from) return;
    const user = await getOrCreateUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    if (user.isBanned) {
      return ctx.reply("🚫 You are banned from this casino.\nReason: " + (user.banReason || "Violation of rules"));
    }

    await ctx.reply(welcomeMessage(user), {
      parse_mode: "MarkdownV2",
      ...mainMenuKeyboard(ctx.from.id),
    });
  });

  bot.help(async (ctx) => {
    await ctx.reply(helpMessage(), {
      parse_mode: "MarkdownV2",
      ...mainMenuKeyboard(ctx.from?.id ?? 0),
    });
  });

  // Main menu — only works for the owner
  bot.action(/^menu_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /start to open your own menu.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    const user = await getOrCreateUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
    await safeEdit(ctx, welcomeMessage(user), {
      parse_mode: "MarkdownV2",
      ...mainMenuKeyboard(ctx.from.id),
    });
  });

  // Help — only the owner
  bot.action(/^help_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /help to get your own help menu.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    await safeEdit(ctx, helpMessage(), {
      parse_mode: "MarkdownV2",
      ...mainMenuKeyboard(ctx.from.id),
    });
  });

  // Cancel personal menu
  bot.action(/^cancel_menu_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ That's not your menu.", { show_alert: true });
    }
    await ctx.answerCbQuery("Cancelled");
    await ctx.deleteMessage().catch(() => {});
  });
}
