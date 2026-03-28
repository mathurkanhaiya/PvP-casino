/**
 * One-time script to generate a GramJS StringSession for the userbot.
 *
 * Run ONCE on any machine (or locally):
 *   TG_API_ID=12345 TG_API_HASH=abcdef TG_PHONE=+1234567890 node scripts/gen-tg-session.mjs
 *
 * Then copy the printed session string and add it as TG_SESSION in your env vars.
 * KEEP THE SESSION STRING SECRET — it gives full access to the Telegram account.
 */

import { createInterface } from "node:readline";
import { createRequire } from "node:module";
globalThis.require = createRequire(import.meta.url);

const apiId   = parseInt(process.env.TG_API_ID   || "", 10);
const apiHash = process.env.TG_API_HASH  || "";
const phone   = process.env.TG_PHONE     || "";

if (!apiId || !apiHash || !phone) {
  console.error("Set TG_API_ID, TG_API_HASH, TG_PHONE before running this script.");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

const { TelegramClient } = await import("telegram");
const { StringSession }  = await import("telegram/sessions/index.js");
const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });

await client.start({
  phoneNumber:   async () => phone,
  password:      async () => ask("Enter your 2FA password (press Enter if none): "),
  phoneCode:     async () => ask("Enter the OTP code sent to your Telegram: "),
  onError:       (err)    => console.error("Auth error:", err),
});

console.log("\n✅ SUCCESS — Your session string:\n");
console.log(client.session.save());
console.log("\nAdd this as TG_SESSION in your environment variables.");
console.log("KEEP IT SECRET — it's like a password for your Telegram account.\n");

await client.disconnect();
rl.close();
process.exit(0);
