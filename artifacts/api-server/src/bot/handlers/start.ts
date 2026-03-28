import { Telegraf, Context } from "telegraf";
import { getOrCreateUser, applyReferral } from "../db.js";
import { welcomeMessage, helpMessage } from "../messages.js";
import { mainMenuKeyboard, privateMenuKeyboard } from "../keyboards.js";
import { esc } from "../escape.js";

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

    // Parse referral: /start ref123456789
    const payload = (ctx as any).startPayload as string | undefined;
    const refMatch = payload?.match(/^ref(\d+)$/);
    const referrerId = refMatch ? parseInt(refMatch[1]) : null;

    const user = await getOrCreateUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    if (user.isBanned) {
      return ctx.reply("🚫 You are banned from this casino.\nReason: " + (user.banReason || "Violation of rules"));
    }

    // Apply referral if applicable (first time only)
    if (referrerId && !(user as any).referredBy) {
      const ref = await applyReferral(ctx.from.id, referrerId);
      if (ref.ok) {
        await ctx.reply(
          `🎉 *Referral Bonus\\!*\n\n✅ You were referred and received *\\+🪙500* bonus coins\\!\n_Your referrer also got a reward\\._`,
          { parse_mode: "MarkdownV2" }
        );
      }
    }

    const isPrivate = ctx.chat?.type === "private";
    await ctx.reply(welcomeMessage(user), {
      parse_mode: "MarkdownV2",
      ...(isPrivate ? privateMenuKeyboard(ctx.from.id) : mainMenuKeyboard(ctx.from.id)),
    });
  });

  bot.help(async (ctx) => {
    const isPrivate = ctx.chat?.type === "private";
    const kb = isPrivate ? privateMenuKeyboard(ctx.from?.id ?? 0) : mainMenuKeyboard(ctx.from?.id ?? 0);
    await ctx.reply(helpMessage(), { parse_mode: "MarkdownV2", ...kb });
  });

  // /refer command — show referral link
  bot.command("refer", async (ctx) => {
    if (!ctx.from) return;
    const botUsername = process.env.BOT_USERNAME || "AdsRewardGameBot";
    const link = `https://t.me/${botUsername}?start=ref${ctx.from.id}`;
    await ctx.reply(
      `🔗 *Your Referral Link*\n\n` +
      `Share this link with friends:\n\`${esc(link)}\`\n\n` +
      `📌 *Rewards:*\n` +
      `• You get: *🪙1,000 coins* per new player\n` +
      `• Friend gets: *🪙500 bonus coins* on join\n\n` +
      `_Referral only counts if your friend is new to the bot\\._`,
      { parse_mode: "MarkdownV2" }
    );
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
    const isPrivate = ctx.chat?.type === "private";
    await safeEdit(ctx, welcomeMessage(user), {
      parse_mode: "MarkdownV2",
      ...(isPrivate ? privateMenuKeyboard(ctx.from.id) : mainMenuKeyboard(ctx.from.id)),
    });
  });

  // Help — respects private vs group chat
  bot.action(/^help_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const ownerId = parseInt(ctx.match[1]);
    if (ctx.from.id !== ownerId) {
      return ctx.answerCbQuery("⚠️ Use /help to get your own help menu.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    const isPrivate = ctx.chat?.type === "private";
    await safeEdit(ctx, helpMessage(), {
      parse_mode: "MarkdownV2",
      ...(isPrivate ? privateMenuKeyboard(ctx.from.id) : mainMenuKeyboard(ctx.from.id)),
    });
  });

  // Section-header buttons (non-interactive labels in keyboards)
  bot.action(/^noop_/, async (ctx) => {
    await ctx.answerCbQuery();
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
