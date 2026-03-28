/**
 * Telegram userbot (GramJS) — sends USDT payouts via @cctip_bot.
 *
 * Requires env vars:
 *   TG_API_ID    — your Telegram API ID (from my.telegram.org)
 *   TG_API_HASH  — your Telegram API hash
 *   TG_SESSION   — GramJS StringSession (use /usdt_setup in bot DM to generate)
 *
 * If these are not set the bot still works but USDT payouts must be done manually.
 */

import { logger } from "../lib/logger.js";

let client: any = null;
let ready = false;

// ── Setup (session generation) state ─────────────────────────────────────────
let pendingOtpResolve: ((code: string) => void) | null = null;
let setupInProgress = false;

export async function initUserbot(): Promise<void> {
  const apiId   = parseInt(process.env.TG_API_ID  || "0", 10);
  const apiHash = process.env.TG_API_HASH || "";
  const session = process.env.TG_SESSION  || "";

  if (!apiId || !apiHash || !session) {
    logger.warn("Userbot not configured — USDT payouts will need manual admin action. " +
                "Set TG_API_ID, TG_API_HASH, TG_SESSION to enable auto-payouts. " +
                "Use /usdt_setup in DM with the bot to generate TG_SESSION.");
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
 * The casino Telegram account must be in the group and have a cctip balance.
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

// ── Session generation helpers ────────────────────────────────────────────────

/**
 * Starts a new GramJS login flow for `phoneNumber`.
 * Returns the session string once fully authenticated.
 * Call `provideOtp(code)` with the SMS/Telegram code that arrives on the phone.
 */
export async function initiateSetup(phoneNumber: string): Promise<string> {
  const apiId   = parseInt(process.env.TG_API_ID  || "0", 10);
  const apiHash = process.env.TG_API_HASH || "";

  if (!apiId || !apiHash) {
    throw new Error("TG_API_ID and TG_API_HASH env vars must be set before running setup.");
  }

  if (setupInProgress) {
    throw new Error("A setup is already in progress. Send the OTP code or restart the bot to cancel.");
  }

  setupInProgress = true;

  const { TelegramClient } = await import("telegram") as any;
  const { StringSession }  = await import("telegram/sessions/index.js") as any;

  const setupClient = new TelegramClient(
    new StringSession(""),
    apiId,
    apiHash,
    { connectionRetries: 3, useWSS: false, appVersion: "1.0.0" }
  );

  await setupClient.start({
    phoneNumber: async () => phoneNumber,
    password:    async () => "",
    phoneCode:   async () => {
      return new Promise<string>((resolve, reject) => {
        pendingOtpResolve = resolve;
        // Auto-reject after 5 minutes
        setTimeout(() => {
          if (pendingOtpResolve === resolve) {
            setupInProgress = false;
            pendingOtpResolve = null;
            reject(new Error("OTP timed out (5 min). Run /usdt_setup again."));
          }
        }, 5 * 60 * 1000);
      });
    },
    onError: (err: any) => {
      setupInProgress = false;
      pendingOtpResolve = null;
      logger.error({ err }, "Userbot setup error");
    },
  });

  const sessionString = setupClient.session.save() as string;
  await setupClient.disconnect();
  setupInProgress = false;
  pendingOtpResolve = null;
  return sessionString;
}

/**
 * Provides the OTP code received on the phone to complete the login flow.
 * @returns true if there was a pending setup waiting for the code
 */
export function provideOtp(code: string): boolean {
  if (!pendingOtpResolve) return false;
  pendingOtpResolve(code);
  pendingOtpResolve = null;
  return true;
}

export function isSetupInProgress(): boolean {
  return setupInProgress;
}
