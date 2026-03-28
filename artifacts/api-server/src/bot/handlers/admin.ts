import { Telegraf, Context } from "telegraf";
import {
  getUserByTelegramId, getAllUsers, getUserCount, getTotalBetsCount, getTotalVolume,
  banUser, unbanUser, setAdminBalance, setUserAdmin, getLeaderboard, expireOldBets
} from "../db.js";
import { adminPanelMessage, formatBalance } from "../messages.js";
import { adminPanelKeyboard, userManagementKeyboard, backToAdminKeyboard } from "../keyboards.js";
import { esc, safeName } from "../escape.js";

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
  const name = user.username ? `@${esc(user.username)}` : (safeName(user.firstName) || `User\\#${user.telegramId}`);
  return `👤 *User Details*

*Name:* ${name}
*ID:* \`${user.telegramId}\`
*Balance:* ${formatBalance(user.balance)}
*Status:* ${user.isBanned ? "🚫 Banned" : "✅ Active"}${user.isAdmin ? " 👑 Admin" : ""}
*Wins/Losses:* ${user.totalWins}/${user.totalLosses}
*Total Bets:* ${user.totalBets}
${user.isBanned && user.banReason ? `*Ban Reason:* ${esc(user.banReason)}` : ""}`.trim();
}

export function registerAdminHandlers(bot: Telegraf<Context>) {
  bot.command("adminpanel", async (ctx) => {
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.reply("🚫 Access denied. Admin only.");

    const stats = {
      users: await getUserCount(),
      bets: await getTotalBetsCount(),
      volume: await getTotalVolume(),
    };

    await ctx.reply(adminPanelMessage(stats), {
      parse_mode: "MarkdownV2",
      ...adminPanelKeyboard(),
    });
  });

  bot.action("admin_panel", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const stats = {
      users: await getUserCount(),
      bets: await getTotalBetsCount(),
      volume: await getTotalVolume(),
    };
    await safeEdit(ctx, adminPanelMessage(stats), { parse_mode: "MarkdownV2", ...adminPanelKeyboard() });
  });

  bot.action("admin_stats", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const users = await getUserCount();
    const bets = await getTotalBetsCount();
    const volume = await getTotalVolume();
    const topPlayers = await getLeaderboard(5);

    const topText = topPlayers.map((u, i) => {
      const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User#${u.telegramId}`);
      return `${i + 1}\\. ${name} — W:${u.totalWins} L:${u.totalLosses} Bal:${formatBalance(u.balance)}`;
    }).join("\n");

    await safeEdit(ctx,
      `📊 *Detailed Bot Statistics*\n\n👥 Users: ${users}\n🎮 Total Bets: ${bets}\n💰 Total Volume: ${formatBalance(volume)}\n\n🏆 *Top 5 Players:*\n${topText || "None yet"}`,
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  bot.action("admin_users", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const users = await getAllUsers(10, 0);
    const userList = users.map(u => {
      const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User#${u.telegramId}`);
      const status = u.isBanned ? "🚫" : (u.isAdmin ? "👑" : "✅");
      return `${status} ${name} — ${formatBalance(u.balance)}`;
    }).join("\n");

    await safeEdit(ctx,
      `👥 *Recent Users \\(last 10\\)*\n\n${userList || "No users yet"}`,
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  bot.action("admin_top", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    const users = await getLeaderboard(10);
    const rows = users.map((u, i) => {
      const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User#${u.telegramId}`);
      return `${i + 1}\\. ${name} \\| Bal: ${formatBalance(u.balance)} \\| W: ${u.totalWins} \\| L: ${u.totalLosses}`;
    }).join("\n");

    await safeEdit(ctx, `🏆 *Top Players*\n\n${rows || "No data"}`, {
      parse_mode: "MarkdownV2",
      ...backToAdminKeyboard(),
    });
  });

  bot.action("admin_find_user", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "find_user" });
    await safeEdit(ctx, "🔍 *Find User*\n\nSend the user's Telegram ID:", {
      parse_mode: "MarkdownV2",
      ...backToAdminKeyboard(),
    });
  });

  bot.action("admin_balance", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "adjust_balance" });
    await safeEdit(ctx,
      "💰 *Adjust Balance*\n\nSend: `user_id amount`\nExample: `123456789 500`\n\nPositive \\= add, Negative \\= subtract",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  bot.action("admin_ban", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "ban_user" });
    await safeEdit(ctx,
      "🚫 *Ban User*\n\nSend: `user_id reason`\nExample: `123456789 Cheating`",
      { parse_mode: "MarkdownV2", ...backToAdminKeyboard() }
    );
  });

  bot.action("admin_unban", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "unban_user" });
    await safeEdit(ctx, "✅ *Unban User*\n\nSend the user's Telegram ID:", {
      parse_mode: "MarkdownV2",
      ...backToAdminKeyboard(),
    });
  });

  bot.action("admin_grant", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "grant_admin" });
    await safeEdit(ctx, "👑 *Grant Admin*\n\nSend the user's Telegram ID:", {
      parse_mode: "MarkdownV2",
      ...backToAdminKeyboard(),
    });
  });

  bot.action("admin_broadcast", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    pendingAdminActions.set(ctx.from.id, { action: "broadcast" });
    await safeEdit(ctx, "📣 *Broadcast Message*\n\nType your message and it will be sent to all users:", {
      parse_mode: "MarkdownV2",
      ...backToAdminKeyboard(),
    });
  });

  bot.action("admin_cancel_bets", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });

    await expireOldBets();
    await safeEdit(ctx, "✅ *All expired bets have been cancelled\\.*", {
      parse_mode: "MarkdownV2",
      ...backToAdminKeyboard(),
    });
  });

  bot.action(/^admin_do_ban_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    await banUser(targetId, "Banned by admin");
    await ctx.answerCbQuery("✅ User banned");
    const user = await getUserByTelegramId(targetId);
    if (user) await safeEdit(ctx, buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
  });

  bot.action(/^admin_do_unban_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    await unbanUser(targetId);
    await ctx.answerCbQuery("✅ User unbanned");
    const user = await getUserByTelegramId(targetId);
    if (user) await safeEdit(ctx, buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
  });

  bot.action(/^admin_grant_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    await setUserAdmin(targetId, true);
    await ctx.answerCbQuery("✅ Admin granted");
    const user = await getUserByTelegramId(targetId);
    if (user) await safeEdit(ctx, buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
  });

  bot.action(/^admin_revoke_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    await setUserAdmin(targetId, false);
    await ctx.answerCbQuery("✅ Admin revoked");
    const user = await getUserByTelegramId(targetId);
    if (user) await safeEdit(ctx, buildUserCard(user), { parse_mode: "MarkdownV2", ...userManagementKeyboard(user) });
  });

  bot.action(/^admin_set_bal_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    pendingAdminActions.set(ctx.from.id, { action: "set_balance", data: { targetId } });
    await ctx.answerCbQuery("Enter new balance in chat");
    await ctx.reply(`Enter new balance for user \`${targetId}\`:`, { parse_mode: "MarkdownV2" });
  });

  bot.action(/^admin_add_bal_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const admin = await checkAdmin(ctx.from.id);
    if (!admin) return ctx.answerCbQuery("🚫 Access denied.", { show_alert: true });
    const targetId = parseInt(ctx.match[1]);
    pendingAdminActions.set(ctx.from.id, { action: "add_balance", data: { targetId } });
    await ctx.answerCbQuery("Enter amount in chat");
    await ctx.reply(`Enter amount to ADD to user \`${targetId}\` \\(negative to subtract\\):`, { parse_mode: "MarkdownV2" });
  });

  // Admin text handler
  bot.on("text", async (ctx, next) => {
    if (!ctx.from) return next();
    const pending = pendingAdminActions.get(ctx.from.id);
    if (!pending) return next();

    const admin = await checkAdmin(ctx.from.id);
    if (!admin) { pendingAdminActions.delete(ctx.from.id); return next(); }

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
          const parts = text.split(" ");
          const uid = parseInt(parts[0]);
          const amount = parseFloat(parts[1]);
          if (isNaN(uid) || isNaN(amount)) return ctx.reply("❌ Invalid format\\. Use: `user_id amount`", { parse_mode: "MarkdownV2" });
          const user = await getUserByTelegramId(uid);
          if (!user) return ctx.reply("❌ User not found\\.", { parse_mode: "MarkdownV2" });
          const newBal = Math.max(0, parseFloat(user.balance as string) + amount);
          await setAdminBalance(uid, newBal);
          await ctx.reply(`✅ Balance updated to ${formatBalance(newBal)} for user \`${uid}\``, { parse_mode: "MarkdownV2" });
          break;
        }
        case "ban_user": {
          const parts = text.split(" ");
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
          await ctx.reply(`✅ Admin granted to user \`${uid}\`\\.`, { parse_mode: "MarkdownV2" });
          break;
        }
        case "broadcast": {
          const users = await getAllUsers(1000, 0);
          let sent = 0, failed = 0;
          for (const user of users) {
            try {
              await ctx.telegram.sendMessage(user.telegramId, `📣 *Admin Announcement:*\n\n${text}`);
              sent++;
            } catch { failed++; }
          }
          await ctx.reply(`✅ Broadcast sent\\!\n✅ Success: ${sent}\n❌ Failed: ${failed}`, { parse_mode: "MarkdownV2" });
          break;
        }
        case "set_balance": {
          const amount = parseFloat(text);
          if (isNaN(amount) || amount < 0) return ctx.reply("❌ Invalid amount\\.", { parse_mode: "MarkdownV2" });
          await setAdminBalance(pending.data.targetId, amount);
          await ctx.reply(`✅ Balance set to ${formatBalance(amount)} for user \`${pending.data.targetId}\`\\.`, { parse_mode: "MarkdownV2" });
          break;
        }
        case "add_balance": {
          const amount = parseFloat(text);
          if (isNaN(amount)) return ctx.reply("❌ Invalid amount\\.", { parse_mode: "MarkdownV2" });
          const user = await getUserByTelegramId(pending.data.targetId);
          if (!user) return ctx.reply("❌ User not found\\.", { parse_mode: "MarkdownV2" });
          const newBal = Math.max(0, parseFloat(user.balance as string) + amount);
          await setAdminBalance(pending.data.targetId, newBal);
          await ctx.reply(`✅ Balance updated to ${formatBalance(newBal)} for user \`${pending.data.targetId}\`\\.`, { parse_mode: "MarkdownV2" });
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
