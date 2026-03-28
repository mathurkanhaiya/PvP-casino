import { Telegraf, Context } from "telegraf";
import {
  getUserByTelegramId, getAllUsers, getUserCount, getTotalBetsCount, getTotalVolume,
  banUser, unbanUser, setAdminBalance, setUserAdmin, getLeaderboard, expireOldBets,
  updateBalance,
} from "../db.js";
import { adminPanelMessage, mv2Num } from "../messages.js";
import { adminPanelKeyboard, userManagementKeyboard, backToAdminKeyboard } from "../keyboards.js";
import { esc, safeName } from "../escape.js";
import { db } from "@workspace/db";
import { depositsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const pendingAdminActions = new Map<number, { action: string; data?: any }>();

async function checkAdmin(telegramId: number): Promise<boolean> {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return false;
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",").map(Number) : [];
  return user.isAdmin || adminIds.includes(telegramId);
}

async function safeEdit(ctx: Context, text: string, extra: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (e: any) {
    if (!e?.message?.includes("message is not modified")) throw e;
  }
}

function buildUserCard(user: any): string {
  const name = user.username
    ? `@${esc(user.username)}`
    : (safeName(user.firstName) || `User\\#${user.telegramId}`);
  const statusLine = user.isBanned
    ? `🚫 Banned${user.banReason ? ` — ${esc(user.banReason)}` : ""}`
    : user.isAdmin ? "👑 Admin" : "✅ Active";

  return `
👤 *User Details*

*Name:* ${name}
*ID:* \`${user.telegramId}\`
*Balance:* ${mv2Num(user.balance)}
*Status:* ${statusLine}
*Wins / Losses:* ${user.totalWins} / ${user.totalLosses}
*Total Bets:* ${user.totalBets}
`.trim();
}

export function registerAdminHandlers(bot: Telegraf<Context>) {

  // ── /adminpanel ─────────────────────────────────────────────────────────────

  bot.command("adminpanel", async (ctx) => {
    if (!ctx.from) return;
    if (!(await checkAdmin(ctx.from.id))) return ctx.reply("🚫 Access denied. Admin only.");

    const stats = {
      users:  await getUserCount(),
      bets:   await getTotalBetsCount(),
      volume: await getTotalVolume(),
    };
    await ctx.reply(adminPanelMessage(stats), { parse_mode: "MarkdownV2", ...adminPanelKeyboard() });
  });

  // ── Panel button — refresh ────────────────────────────────────────────────────

  bot.action("admin_panel", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const stats = {
      users:  await getUserCount(),
      bets:   await getTotalBetsCount(),
      volume: await getTotalVolume(),
    };
    await safeEdit(ctx, adminPanelMessage(stats), { parse_mode: "MarkdownV2", ...adminPanelKeyboard() });
  });

  // ── Statistics ────────────────────────────────────────────────────────────────

  bot.action("admin_stats", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const users   = await getUserCount();
    const bets    = await getTotalBetsCount();
    const volume  = await getTotalVolume();
    const topPlayers = await getLeaderboard(5);

    const topText = topPlayers.map((u, i) => {
      const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User#${u.telegramId}`);
      return `${i + 1}\\. ${name} — W:${u.totalWins} L:${u.totalLosses} Bal:${mv2Num(u.balance)}`;
    }).join("\n");

    await safeEdit(ctx,
      `📊 *Bot Statistics*\n\n👥 Users: *${users.toLocaleString()}*\n🎮 Bets: *${bets.toLocaleString()}*\n💰 Volume: *${mv2Num(volume)}*\n\n🏆 *Top 5 Players:*\n${topText || "None yet"}`,
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── All users ──────────────────────────────────────────────────────────────────

  bot.action("admin_users", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const users = await getAllUsers(10, 0);
    const userList = users.map(u => {
      const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User#${u.telegramId}`);
      const status = u.isBanned ? "🚫" : u.isAdmin ? "👑" : "✅";
      return `${status} ${name} — ${mv2Num(u.balance)}`;
    }).join("\n");

    await safeEdit(ctx,
      `👥 *Recent Users \\(latest 10\\)*\n\n${userList || "No users yet"}`,
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── Top players ────────────────────────────────────────────────────────────────

  bot.action("admin_top", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const users = await getLeaderboard(10);
    const rows = users.map((u, i) => {
      const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User#${u.telegramId}`);
      return `${i + 1}\\. ${name} \\| Bal: ${mv2Num(u.balance)} \\| W: ${u.totalWins} L: ${u.totalLosses}`;
    }).join("\n");

    await safeEdit(ctx,
      `🏆 *Top Players*\n\n${rows || "No data yet"}`,
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── Find user ──────────────────────────────────────────────────────────────────

  bot.action("admin_find_user", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "find_user" });
    await safeEdit(ctx,
      "🔍 *Find User*\n\nSend the user's Telegram ID:",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── Adjust balance buttons ─────────────────────────────────────────────────────

  bot.action("admin_add_coins", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "adjust_balance" });
    await safeEdit(ctx,
      "💰 *Add / Remove Coins*\n\nSend: `userId amount`\nPositive \\= add, Negative \\= subtract\n\nExample: `123456789 500`  or  `123456789 \\-200`",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  bot.action("admin_remove_coins", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "adjust_balance" });
    await safeEdit(ctx,
      "💸 *Remove Coins*\n\nSend: `userId amount`\nPositive number \\= coins to remove\\.\n\nExample: `123456789 500`",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // Keep old action name for compatibility
  bot.action("admin_balance", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    pendingAdminActions.set(ctx.from.id, { action: "adjust_balance" });
    await safeEdit(ctx,
      "💰 *Adjust Balance*\n\nSend: `userId amount`\nPositive \\= add, Negative \\= subtract",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── Ban / Unban ────────────────────────────────────────────────────────────────

  bot.action("admin_ban", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "ban_user" });
    await safeEdit(ctx,
      "🚫 *Ban User*\n\nSend: `userId reason`\nExample: `123456789 Cheating`",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  bot.action("admin_unban", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "unban_user" });
    await safeEdit(ctx,
      "✅ *Unban User*\n\nSend the user's Telegram ID:",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── Grant admin ────────────────────────────────────────────────────────────────

  bot.action("admin_grant", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "grant_admin" });
    await safeEdit(ctx,
      "👑 *Grant Admin*\n\nSend the user's Telegram ID:",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── Broadcast ─────────────────────────────────────────────────────────────────

  bot.action("admin_broadcast", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "broadcast" });
    await safeEdit(ctx,
      "📣 *Broadcast Message*\n\nType your message — it will be sent to all users:",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── Cancel old bets ────────────────────────────────────────────────────────────

  bot.action("admin_cancel_bets", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    await expireOldBets();
    await safeEdit(ctx,
      "✅ *All expired bets have been cancelled\\.*",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── ⭐ Refund Stars ────────────────────────────────────────────────────────────

  bot.action("admin_refund_stars", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "refund_stars" });
    await safeEdit(ctx,
      "⭐ *Refund Stars*\n\nSend the *Telegram Charge ID* of the deposit to refund\\.\n\n_The charge ID was shown in the deposit confirmation message\\. It looks like: `xxxxxx_xxx_xxxx`_\n\nSend it now:",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  // ── /refund command ────────────────────────────────────────────────────────────

  bot.command("refund", async (ctx) => {
    if (!ctx.from) return;
    if (!(await checkAdmin(ctx.from.id))) return ctx.reply("🚫 Access denied. Admin only.");

    const chargeId = ctx.message.text.trim().split(/\s+/).slice(1).join("").trim();
    if (!chargeId) {
      return ctx.reply(
        "❌ Usage: `/refund chargeId`\n\nFind the charge ID in the user's deposit confirmation message\\.",
        { parse_mode: "MarkdownV2" }
      );
    }
    await doStarRefund(ctx, chargeId);
  });

  // ── Inline action: ban/unban/grant/revoke from user card ───────────────────────

  bot.action(/^admin_do_ban_(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    await banUser(targetId, "Banned by admin");
    await ctx.answerCbQuery("✅ User banned");
    const user = await getUserByTelegramId(targetId);
    if (user) await safeEdit(ctx, buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
  });

  bot.action(/^admin_do_unban_(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    await unbanUser(targetId);
    await ctx.answerCbQuery("✅ User unbanned");
    const user = await getUserByTelegramId(targetId);
    if (user) await safeEdit(ctx, buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
  });

  bot.action(/^admin_grant_(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    await setUserAdmin(targetId, true);
    await ctx.answerCbQuery("✅ Admin granted");
    const user = await getUserByTelegramId(targetId);
    if (user) await safeEdit(ctx, buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
  });

  bot.action(/^admin_revoke_(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    await setUserAdmin(targetId, false);
    await ctx.answerCbQuery("✅ Admin revoked");
    const user = await getUserByTelegramId(targetId);
    if (user) await safeEdit(ctx, buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
  });

  bot.action(/^admin_set_bal_(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    pendingAdminActions.set(ctx.from.id, { action: "set_balance", data: { targetId } });
    await ctx.answerCbQuery("Enter new balance in chat");
    await ctx.reply(`Enter new balance for user \`${targetId}\`:`, { parse_mode: "MarkdownV2" });
  });

  bot.action(/^admin_add_bal_(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    pendingAdminActions.set(ctx.from.id, { action: "add_balance", data: { targetId } });
    await ctx.answerCbQuery("Enter amount in chat");
    await ctx.reply(
      `Enter amount for user \`${targetId}\` \\(positive to add, negative to subtract\\):`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // ── Admin quick commands ───────────────────────────────────────────────────────

  bot.command("add", async (ctx) => {
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.reply("🚫 Access denied. Admin only.");
    const parts = ctx.message.text.trim().split(/\s+/);
    const uid = parseInt(parts[1]);
    const amount = parseFloat(parts[2]);
    if (isNaN(uid) || isNaN(amount) || amount <= 0)
      return ctx.reply("❌ Usage: `/add userId amount`\nExample: `/add 123456789 500`", { parse_mode: "MarkdownV2" });
    const user = await getUserByTelegramId(uid);
    if (!user) return ctx.reply("❌ User not found\\.", { parse_mode: "MarkdownV2" });
    const newBal = parseFloat(user.balance as string) + amount;
    await setAdminBalance(uid, newBal);
    await ctx.reply(
      `✅ *Added ${mv2Num(amount)} to* \`${uid}\`\n📜 New balance: ${mv2Num(newBal)}`,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.command("remove", async (ctx) => {
    if (!ctx.from || !(await checkAdmin(ctx.from.id)))
      return ctx.reply("🚫 Access denied. Admin only.");
    const parts = ctx.message.text.trim().split(/\s+/);
    const uid = parseInt(parts[1]);
    const amount = parseFloat(parts[2]);
    if (isNaN(uid) || isNaN(amount) || amount <= 0)
      return ctx.reply("❌ Usage: `/remove userId amount`\nExample: `/remove 123456789 500`", { parse_mode: "MarkdownV2" });
    const user = await getUserByTelegramId(uid);
    if (!user) return ctx.reply("❌ User not found\\.", { parse_mode: "MarkdownV2" });
    const newBal = Math.max(0, parseFloat(user.balance as string) - amount);
    await setAdminBalance(uid, newBal);
    await ctx.reply(
      `✅ *Removed ${mv2Num(amount)} from* \`${uid}\`\n📜 New balance: ${mv2Num(newBal)}`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // ── Admin text handler ────────────────────────────────────────────────────────

  bot.on("text", async (ctx, next) => {
    if (!ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next();
    const pending = pendingAdminActions.get(ctx.from.id);
    if (!pending) return next();

    if (!(await checkAdmin(ctx.from.id))) {
      pendingAdminActions.delete(ctx.from.id);
      return next();
    }

    pendingAdminActions.delete(ctx.from.id);
    const text = ctx.message.text.trim();

    try {
      switch (pending.action) {

        case "find_user": {
          const id = parseInt(text);
          const user = isNaN(id) ? null : await getUserByTelegramId(id);
          if (!user) return ctx.reply("❌ User not found\\.", { parse_mode: "MarkdownV2" });
          await ctx.reply(buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
          break;
        }

        case "adjust_balance": {
          const parts = text.split(/\s+/);
          const uid = parseInt(parts[0]);
          const amount = parseFloat(parts[1]);
          if (isNaN(uid) || isNaN(amount))
            return ctx.reply("❌ Invalid format\\. Use: `userId amount`", { parse_mode: "MarkdownV2" });
          const user = await getUserByTelegramId(uid);
          if (!user) return ctx.reply("❌ User not found\\.", { parse_mode: "MarkdownV2" });
          const newBal = Math.max(0, parseFloat(user.balance as string) + amount);
          await setAdminBalance(uid, newBal);
          await ctx.reply(`✅ Balance updated to ${mv2Num(newBal)} for \`${uid}\`\\.`, { parse_mode: "MarkdownV2" });
          break;
        }

        case "ban_user": {
          const parts = text.split(/\s+/);
          const uid = parseInt(parts[0]);
          const reason = parts.slice(1).join(" ") || "Banned by admin";
          if (isNaN(uid)) return ctx.reply("❌ Invalid user ID\\.", { parse_mode: "MarkdownV2" });
          await banUser(uid, reason);
          await ctx.reply(`✅ User \`${uid}\` banned\\.\nReason: ${esc(reason)}`, { parse_mode: "MarkdownV2" });
          break;
        }

        case "unban_user": {
          const uid = parseInt(text);
          if (isNaN(uid)) return ctx.reply("❌ Invalid user ID\\.", { parse_mode: "MarkdownV2" });
          await unbanUser(uid);
          await ctx.reply(`✅ User \`${uid}\` unbanned\\.`, { parse_mode: "MarkdownV2" });
          break;
        }

        case "grant_admin": {
          const uid = parseInt(text);
          if (isNaN(uid)) return ctx.reply("❌ Invalid user ID\\.", { parse_mode: "MarkdownV2" });
          await setUserAdmin(uid, true);
          await ctx.reply(`✅ Admin granted to \`${uid}\`\\.`, { parse_mode: "MarkdownV2" });
          break;
        }

        case "broadcast": {
          const users = await getAllUsers(1000, 0);
          let sent = 0, failed = 0;
          for (const user of users) {
            try {
              await ctx.telegram.sendMessage(user.telegramId, `📣 *Announcement:*\n\n${text}`, { parse_mode: "Markdown" });
              sent++;
            } catch { failed++; }
          }
          await ctx.reply(
            `✅ *Broadcast sent\\!*\n✅ Delivered: ${sent}\n❌ Failed: ${failed}`,
            { parse_mode: "MarkdownV2" }
          );
          break;
        }

        case "set_balance": {
          const amount = parseFloat(text);
          if (isNaN(amount) || amount < 0) return ctx.reply("❌ Invalid amount\\.", { parse_mode: "MarkdownV2" });
          await setAdminBalance(pending.data.targetId, amount);
          await ctx.reply(
            `✅ Balance set to ${mv2Num(amount)} for \`${pending.data.targetId}\`\\.`,
            { parse_mode: "MarkdownV2" }
          );
          break;
        }

        case "add_balance": {
          const amount = parseFloat(text);
          if (isNaN(amount)) return ctx.reply("❌ Invalid amount\\.", { parse_mode: "MarkdownV2" });
          const user = await getUserByTelegramId(pending.data.targetId);
          if (!user) return ctx.reply("❌ User not found\\.", { parse_mode: "MarkdownV2" });
          const newBal = Math.max(0, parseFloat(user.balance as string) + amount);
          await setAdminBalance(pending.data.targetId, newBal);
          await ctx.reply(
            `✅ Balance updated to ${mv2Num(newBal)} for \`${pending.data.targetId}\`\\.`,
            { parse_mode: "MarkdownV2" }
          );
          break;
        }

        case "refund_stars": {
          await doStarRefund(ctx, text);
          break;
        }

        default:
          return next();
      }
    } catch (err) {
      await ctx.reply("❌ An error occurred\\. Please try again\\.", { parse_mode: "MarkdownV2" });
    }
  });
}

// ── Star refund helper ─────────────────────────────────────────────────────────

async function doStarRefund(ctx: Context, chargeId: string) {
  // Look up the deposit record
  const deposits = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.telegramChargeId, chargeId))
    .limit(1);

  if (!deposits.length) {
    return ctx.reply(
      `❌ No deposit found with charge ID:\n\`${esc(chargeId)}\`\n\n_Double\\-check the ID from the deposit confirmation message\\._`,
      { parse_mode: "MarkdownV2" }
    );
  }

  const deposit = deposits[0];
  const user = await getUserByTelegramId(deposit.userId);
  const userName = user?.username ? `@${esc(user.username)}` : `User \`${deposit.userId}\``;

  // Send refund request to Telegram
  try {
    await ctx.telegram.callApi("refundStarPayment" as any, {
      user_id: deposit.userId,
      telegram_payment_charge_id: chargeId,
    } as any);
  } catch (err: any) {
    return ctx.reply(
      `❌ *Telegram refund failed:*\n\`${esc(err?.message ?? String(err))}\`\n\n_This charge ID may have already been refunded, or it's older than 30 days\\._`,
      { parse_mode: "MarkdownV2" }
    );
  }

  // Deduct the coins that were granted for this deposit
  const coinsToDeduct = parseFloat(deposit.coinsAwarded as string);
  const currentBal = parseFloat(user?.balance as string ?? "0");
  const newBal = Math.max(0, currentBal - coinsToDeduct);
  await setAdminBalance(deposit.userId, newBal);

  // Log the transaction
  await updateBalance(deposit.userId, -coinsToDeduct, "star_refund" as any,
    `Stars refund — ${deposit.stars}★ returned`, undefined);

  await ctx.reply(
    `✅ *Stars Refunded Successfully\\!*\n\n` +
    `👤 User: ${userName}\n` +
    `⭐ Stars returned: *${deposit.stars}*\n` +
    `🪙 Coins deducted: *${mv2Num(coinsToDeduct)}*\n` +
    `💰 New balance: ${mv2Num(newBal)}`,
    { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
  );
}
