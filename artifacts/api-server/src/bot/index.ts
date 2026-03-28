import { Telegraf } from "telegraf";
import { logger } from "../lib/logger.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerPlayHandlers } from "./handlers/play.js";
import { registerGameHandlers } from "./handlers/game.js";
import { registerStatsHandlers } from "./handlers/stats.js";
import { registerAdminHandlers } from "./handlers/admin.js";
import { registerWalletHandlers } from "./handlers/wallet.js";
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

// Expire stale bets every 5 minutes
setInterval(async () => {
  try {
    await expireOldBets();
  } catch (err) {
    logger.error({ err }, "Error expiring bets");
  }
}, 5 * 60 * 1000);

export { bot };
