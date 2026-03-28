/**
 * Telegram userbot (GramJS) — sends USDT payouts via @CWalletBot.
 *
 * Requires env vars:
 *   TG_API_ID    — your Telegram API ID (from my.telegram.org)
 *   TG_API_HASH  — your Telegram API hash
 *   TG_SESSION   — GramJS StringSession (run scripts/gen-tg-session.mjs once to get it)
 *
 * If these are not set the bot still works but USDT payouts must be done manually.
 */

import { logger } from "../lib/logger.js";

let client: any = null;
let ready = false;

export async function initUserbot(): Promise<void> {
  const apiId   = parseInt(process.env.TG_API_ID  || "0", 10);
  const apiHash = process.env.TG_API_HASH || "";
  const session = process.env.TG_SESSION  || "";

  if (!apiId || !apiHash || !session) {
    logger.warn("Userbot not configured — USDT payouts will need manual admin action. " +
                "Set TG_API_ID, TG_API_HASH, TG_SESSION to enable auto-payouts.");
    return;
  }

  try {
    const { TelegramClient }  = await import("telegram") as any;
    const { StringSession }   = await import("telegram/sessions/index.js") as any;

    client = new TelegramClient(
      new StringSession(session),
      apiId,
      apiHash,
      { connectionRetries: 5, useWSS: false, appVersion: "1.0.0" }
    );

    await client.connect();
    ready = true;
    logger.info("Userbot connected and ready for USDT payouts.");
  } catch (err) {
    logger.error({ err }, "Userbot connection failed — payouts will be manual.");
  }
}

export function isUserbotReady(): boolean {
  return ready;
}

/**
 * Sends a USDT tip to `winnerUsername` by sending the tip command into the group chat.
 * The casino Telegram account must be in the group and have a Cwallet balance.
 *
 * @returns true if the message was sent, false on failure.
 */
export async function sendUsdtPayout(
  winnerUsername: string,
  amountUsdt: number,
  chatId: number
): Promise<boolean> {
  if (!ready || !client) return false;
  if (!winnerUsername) return false;

  try {
    const fmt = amountUsdt.toFixed(4).replace(/\.?0+$/, "") || "0";
    const cmd = `/tip ${fmt} USDT @${winnerUsername}`;
    await client.sendMessage(chatId, { message: cmd });
    logger.info({ winnerUsername, amountUsdt, chatId }, "USDT payout tip command sent via userbot");
    return true;
  } catch (err) {
    logger.error({ err, winnerUsername, amountUsdt }, "Userbot failed to send USDT payout");
    return false;
  }
}
