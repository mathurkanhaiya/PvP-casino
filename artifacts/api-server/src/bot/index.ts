import { Telegraf } from "telegraf";
import { logger } from "../lib/logger.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerPlayHandlers } from "./handlers/play.js";
import { registerGameHandlers } from "./handlers/game.js";
import { registerStatsHandlers } from "./handlers/stats.js";
import { registerAdminHandlers } from "./handlers/admin.js";
import { registerWalletHandlers } from "./handlers/wallet.js";
import { registerPaymentHandlers } from "./handlers/payment.js";
import { expireOldBets } from "./db.js";

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Global error handler
bot.catch((err, ctx) => {
  logger.error({ err, updateType: ctx.updateType }, "Bot error");
});

// Register all handlers
registerStartHandlers(bot);
registerPlayHandlers(bot);
registerGameHandlers(bot);
registerStatsHandlers(bot);
registerAdminHandlers(bot);
registerWalletHandlers(bot);
registerPaymentHandlers(bot);

// Register commands with Telegram so they appear in autocomplete
bot.telegram.setMyCommands([
  { command: "start",      description: "🏠 Main menu & balance" },
  { command: "play",       description: "🎮 Choose game & create a bet" },
  { command: "dice",       description: "🎲 Quick dice bet  —  /dice 100" },
  { command: "darts",      description: "🎯 Quick darts bet  —  /darts 100" },
  { command: "football",   description: "⚽ Quick football bet  —  /football 100" },
  { command: "bowling",    description: "🎳 Quick bowling bet  —  /bowling 100" },
  { command: "basketball", description: "🏀 Quick basketball bet  —  /basketball 100" },
  { command: "slots",      description: "🎰 Quick slots bet  —  /slots 100" },
  { command: "coinflip",   description: "🪙 Quick coin flip bet  —  /coinflip 100" },
  { command: "rps",        description: "🤜 Quick rock paper scissors  —  /rps 100" },
  { command: "highcard",   description: "🃏 Quick high card bet  —  /highcard 100" },
  { command: "baccarat",   description: "🀄 Quick baccarat bet  —  /baccarat 100" },
  { command: "dragon",     description: "🐉 Quick dragon tiger bet  —  /dragon 100" },
  { command: "evenodd",    description: "⚡ Quick even/odd bet  —  /evenodd 100" },
  { command: "lucky7",     description: "🔢 Quick lucky 7 bet  —  /lucky7 100" },
  { command: "wheel",      description: "🎡 Quick wheel spin bet  —  /wheel 100" },
  { command: "bets",       description: "📋 Active bets in this chat" },
  { command: "wallet",     description: "📜 Transaction history" },
  { command: "stats",      description: "📊 Your stats & profile" },
  { command: "leaderboard", description: "🏆 Top players" },
  { command: "daily",      description: "🎁 Claim daily bonus (500 coins)" },
  { command: "deposit",    description: "💳 Deposit via Telegram Stars  —  /deposit 10" },
  { command: "withdraw",   description: "💸 Withdraw coins as a Telegram Gift" },
  { command: "help",       description: "❓ Help & command list" },
  { command: "adminpanel", description: "⚙️ Admin panel (admins only)" },
]).then(() => {
  logger.info("Bot commands registered with Telegram");
}).catch((err) => {
  logger.warn({ err }, "Failed to register bot commands — continuing anyway");
});

// Expire stale bets every 5 minutes
setInterval(async () => {
  try {
    await expireOldBets();
  } catch (err) {
    logger.error({ err }, "Error expiring bets");
  }
}, 5 * 60 * 1000);

export { bot };
