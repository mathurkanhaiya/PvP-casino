import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { bot } from "./bot/index.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── Bot startup ──────────────────────────────────────────────────────────────
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

async function startBot() {
  // Always verify token first
  try {
    const me = await bot.telegram.getMe();
    logger.info({ username: me.username }, "Bot token verified");
  } catch (err) {
    logger.error({ err }, "Bot token verification FAILED — check TELEGRAM_BOT_TOKEN");
    return;
  }

  if (WEBHOOK_DOMAIN) {
    // ── Webhook mode (Railway / production) ──────────────────────────────────
    logger.info({ domain: WEBHOOK_DOMAIN }, "Starting bot in WEBHOOK mode");
    try {
      const webhookMiddleware = await bot.createWebhook({
        domain: WEBHOOK_DOMAIN,
        hookPath: "/webhook/telegram",
      });
      app.use(webhookMiddleware);
      logger.info("Webhook registered — bot is live");
    } catch (err) {
      logger.error({ err }, "Webhook setup failed — falling back to polling");
      startPolling();
    }
  } else {
    // ── Long-polling mode (Replit / local dev) ────────────────────────────────
    startPolling();
  }
}

function startPolling() {
  logger.info("Starting bot in POLLING mode");
  bot.launch({
    dropPendingUpdates: false,
  });
  // bot.launch() doesn't resolve until stopped, so confirm via separate log
  setTimeout(() => {
    logger.info("Bot polling is active and handling updates");
  }, 2000);
}

startBot().catch(err => {
  logger.error({ err }, "Fatal: bot startup failed");
});

// Graceful shutdown
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export default app;
