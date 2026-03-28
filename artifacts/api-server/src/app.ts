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

// ── Bot startup ─────────────────────────────────────────────────────────────
// When WEBHOOK_DOMAIN is set (Railway / any server with a public HTTPS URL),
// use webhook mode — Telegram pushes updates directly to this server.
// When unset (local Replit dev), use long-polling.

const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN; // e.g. your-casino-bot-production.up.railway.app

async function startBot() {
  if (WEBHOOK_DOMAIN) {
    try {
      const webhookMiddleware = await bot.createWebhook({
        domain: WEBHOOK_DOMAIN,
        hookPath: "/webhook/telegram",
      });
      app.use(webhookMiddleware);
      logger.info({ domain: WEBHOOK_DOMAIN }, "Bot started in webhook mode");
    } catch (err) {
      logger.error({ err }, "Failed to set up webhook — falling back to polling");
      bot.launch().catch(e => logger.error({ e }, "Polling fallback also failed"));
    }
  } else {
    // Local development — long polling
    bot.launch().then(() => {
      logger.info("Bot started in polling mode (local dev)");
    }).catch(err => {
      logger.error({ err }, "Failed to launch bot in polling mode");
    });
  }
}

startBot();

// Graceful shutdown
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export default app;
