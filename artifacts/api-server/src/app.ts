import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { bot } from "./bot/index.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

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

// ── DB migration (inline — no drizzle-kit needed at runtime) ─────────────────
async function runMigrations() {
  logger.info("Running DB migrations...");
  await db.execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastWeeklyAt" TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "referredBy" INTEGER;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "totalReferrals" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE bets ADD COLUMN IF NOT EXISTS "pinMessageId" INTEGER;
    ALTER TABLE bets ADD COLUMN IF NOT EXISTS "pinChatId" BIGINT;
  `);
  logger.info("DB migrations done");
}

// ── Bot startup ───────────────────────────────────────────────────────────────
async function startBot() {
  await runMigrations();

  try {
    const me = await bot.telegram.getMe();
    logger.info({ username: me.username }, "Bot token verified — starting polling");
  } catch (err) {
    logger.error({ err }, "Bot token verification FAILED — check TELEGRAM_BOT_TOKEN");
    return;
  }

  // Long polling — the only mode. Handle 409 gracefully (another instance running)
  bot.launch().catch((err: any) => {
    if (err?.response?.error_code === 409) {
      logger.warn("Another bot instance is already polling (Railway). This instance will not handle updates.");
    } else {
      logger.error({ err }, "Bot polling stopped unexpectedly");
      process.exit(1);
    }
  });

  setTimeout(() => logger.info("Bot polling is active"), 2000);
}

startBot().catch(err => {
  logger.error({ err }, "Fatal: bot startup failed");
  process.exit(1);
});

// Graceful shutdown
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export default app;
