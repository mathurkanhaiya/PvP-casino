import { Telegraf, Context } from "telegraf";
import { getOrCreateUser } from "../db.js";
import { welcomeMessage, helpMessage } from "../messages.js";
import { mainMenuKeyboard } from "../keyboards.js";

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
      parse_mode: "Markdown",
      ...mainMenuKeyboard(),
    });
  });

  bot.help(async (ctx) => {
    await ctx.reply(helpMessage(), {
      parse_mode: "Markdown",
      ...mainMenuKeyboard(),
    });
  });

  bot.action("start", async (ctx) => {
    if (!ctx.from) return;
    await ctx.answerCbQuery();

    const user = await getOrCreateUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    await ctx.editMessageText(welcomeMessage(user), {
      parse_mode: "Markdown",
      ...mainMenuKeyboard(),
    });
  });

  bot.action("help", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(helpMessage(), {
      parse_mode: "Markdown",
      ...mainMenuKeyboard(),
    });
  });

  bot.action("cancel", async (ctx) => {
    await ctx.answerCbQuery("Cancelled");
    await ctx.deleteMessage().catch(() => {});
  });
}
