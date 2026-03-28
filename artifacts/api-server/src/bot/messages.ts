import { GAMES, GameType, COINS_PER_STAR } from "./config.js";
import { safeName, esc } from "./escape.js";
import { levelBadge, levelProgress, MAX_LEVEL } from "./levels.js";
import type { User, Bet, Transaction } from "@workspace/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

export function formatBalance(amount: string | number) {
  return `🪙 ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Format a number for MarkdownV2 (escapes . and -) */
export function mv2Num(amount: string | number): string {
  const n = Number(amount);
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const escaped = formatted.replace(/\./g, "\\.");
  const sign = n < 0 ? "\\-" : "";
  return `🪙 ${sign}${escaped}`;
}

/** Signed mv2 number — always shows + or - prefix */
function mv2SignedNum(amount: string | number): string {
  const n = Number(amount);
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const escaped = formatted.replace(/\./g, "\\.");
  const sign = n >= 0 ? "\\+" : "\\-";
  return `🪙 ${sign}${escaped}`;
}

export function displayName(user: User): string {
  if (user.username) return `@${user.username}`;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || `User#${user.telegramId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Welcome & Help
// ─────────────────────────────────────────────────────────────────────────────

export function welcomeMessage(user: User) {
  const name = safeName(user.firstName) || "Player";
  const streak = (user as any).currentStreak > 1
    ? `🔥 *Win Streak: ${(user as any).currentStreak}x* \\(Best: ${(user as any).bestStreak}\\)\n`
    : "";

  const xp = (user as any).xp as number ?? 0;
  const prog = levelProgress(xp);
  const badge = levelBadge(prog.level);
  const levelStr = `${badge} Level ${prog.level}`;

  return `
🎰 *PvP Casino* — Welcome back, ${name}\\!

💰 Balance: *${mv2Num(user.balance)}*
${streak}${levelStr} \\| XP: ${prog.current}/${prog.level >= MAX_LEVEL ? "MAX" : prog.needed}

*🎲 Dice Games* \\(send emoji to play\\)
\`/dice\` \`/darts\` \`/football\` \`/bowling\` \`/basketball\` \`/slots\`

*⚡ Instant Games* \\(resolved instantly\\)
\`/coinflip\` \`/rps\` \`/highcard\` \`/baccarat\`
\`/dragon\` \`/evenodd\` \`/lucky7\` \`/wheel\`

_All commands accept an amount: e\\.g\\. \`/dice 500\`_
`.trim();
}

export function helpMessage() {
  return `
🎰 *PvP Casino Bot — Help Guide*

*📌 Main Commands:*
/start — Dashboard & balance
/play — Pick a game & create a bet
/bets — Active bets in this chat
/mybets — Your active bets \\+ cancel
/stats — Your profile, level & XP
/leaderboard — Top players ranking
/daily — Claim daily bonus \\(🪙500\\)
/weekly — Claim weekly bonus \\(🪙2,500\\)
/deposit — Deposit via Telegram Stars
/wallet — Transaction history
/refer — Get your referral link
/help — This message

*🎲 Dice Games* _\\(send emoji after accepting\\)_
/dice — Roll 1\\-6, highest wins
/darts — Bullseye 1\\-6 wins
/football — Score 0\\-5, highest wins
/bowling — Strike 0\\-6 wins
/basketball — Swish 0\\-5 wins
/slots — Spin 1\\-64, jackpot at 64\\!

*⚡ Instant Games* _\\(no emoji needed\\)_
/coinflip — Heads or Tails
/rps — Rock, Paper, Scissors
/highcard — Draw 1\\-13, highest wins
/baccarat — Player vs Banker \\(0\\-9\\)
/dragon — Dragon or Tiger card game
/evenodd — Even or Odd dice roll
/lucky7 — Closest card to 7 wins
/wheel — Spin 1\\-8, highest wins

*💡 How PvP Works:*
1\\. Create a bet \\(game \\+ amount\\)
2\\. Anyone in the group can accept
3\\. Play out — winner takes the pot
4\\. Tie \\= full refund to both players

*💳 Deposit ⭐ Stars:*
⭐ 1 Star \\= 🪙500 coins \\| Min: 1 Star

_Must be in a group chat to create bets_
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile / Stats
// ─────────────────────────────────────────────────────────────────────────────

export function profileMessage(user: User, rank: number) {
  const winRate = user.totalBets > 0
    ? ((user.totalWins / user.totalBets) * 100).toFixed(1).replace(".", "\\.")
    : "0\\.0";

  const profit = parseFloat(user.totalWon as string) - parseFloat(user.totalWagered as string);
  const profitEmoji = profit >= 0 ? "📈" : "📉";
  const profitStr = mv2SignedNum(profit);

  const name = safeName(user.firstName) || "Unknown";
  const usernameStr = user.username ? ` \\(@${esc(user.username)}\\)` : "";
  const streak = (user as any).currentStreak > 0
    ? `\n🔥 *Win Streak:* ${(user as any).currentStreak} \\(Best: ${(user as any).bestStreak}\\)` : "";

  // Level & XP
  const xp = (user as any).xp as number ?? 0;
  const prog = levelProgress(xp);
  const badge = levelBadge(prog.level);
  const barFilled = Math.round(prog.pct / 10);
  const bar = "█".repeat(barFilled) + "░".repeat(10 - barFilled);
  const levelLine = prog.level >= MAX_LEVEL
    ? `\n${badge} *Level MAX* \\(${MAX_LEVEL}\\) — Legendary\\!`
    : `\n${badge} *Level ${prog.level}* \\| XP: ${prog.current}/${prog.needed}\n\`${bar}\` ${prog.pct}%`;

  const refs = (user as any).totalReferrals as number ?? 0;
  const refLine = refs > 0 ? `\n👥 *Referrals:* ${refs}` : "";

  return `
👤 *Player Profile*

*Name:* ${name}${usernameStr}
*ID:* \`${user.telegramId}\`
🏆 *Rank:* \\#${rank}${levelLine}${streak}

💰 *Balance:* ${mv2Num(user.balance)}
📊 *Win Rate:* ${winRate}%
${profitEmoji} *Profit / Loss:* ${profitStr}

🎮 *Total Bets:* ${user.totalBets}
✅ *Wins:* ${user.totalWins}
❌ *Losses:* ${user.totalLosses}
💵 *Total Wagered:* ${mv2Num(user.totalWagered)}
🏅 *Total Won:* ${mv2Num(user.totalWon)}${refLine}
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Bet flow
// ─────────────────────────────────────────────────────────────────────────────

export function betCreatedMessage(bet: Bet, creatorDisplayName: string, gameKey: GameType) {
  const game = GAMES[gameKey];
  const safeCreator = esc(creatorDisplayName);
  const CHOICE_LABELS: Record<string, Record<string, string>> = {
    coinflip: { heads: "🌕 Heads", tails: "🌑 Tails" },
    baccarat: { player: "🎰 Player", banker: "🏦 Banker" },
    dragon:   { dragon: "🐉 Dragon", tiger: "🐯 Tiger" },
    evenodd:  { even: "2️⃣ Even", odd: "1️⃣ Odd" },
  };
  const choiceLabel = CHOICE_LABELS[gameKey]?.[bet.creatorChoice || ""] || bet.creatorChoice || "";
  const choiceNote = choiceLabel ? `\n${game.emoji} Creator picked: *${choiceLabel}*` : "";

  const INSTANT_GAMES = ["highcard", "baccarat", "dragon", "evenodd", "lucky7", "wheel"];
  const playNote = game.isDice
    ? `_Both players send ${game.telegramEmoji} after accepting_`
    : gameKey === "rps"
      ? `_Both players pick via buttons after accepting\\!_`
      : INSTANT_GAMES.includes(gameKey)
        ? `_Resolves instantly when opponent accepts\\!_`
        : `_Coin flips instantly when opponent accepts\\!_`;

  return `
${game.emoji} *New PvP Bet — ${game.name}*

💰 *Bet:* ${mv2Num(bet.amount)} each \\| 🏆 *Pot:* ${mv2Num(Number(bet.amount) * 2)}
👤 *Creator:* ${safeCreator}${choiceNote}

📖 ${esc(game.description)}

${playNote}
⏱ Expires in 10 minutes\\.
`.trim();
}

export function betActiveMessage(bet: Bet, creatorDisplayName: string, challengerDisplayName: string, gameKey: GameType) {
  const game = GAMES[gameKey];
  const c1 = esc(creatorDisplayName);
  const c2 = esc(challengerDisplayName);
  const INSTANT_GAMES2 = ["highcard", "baccarat", "dragon", "evenodd", "lucky7", "wheel"];
  const instrLine = game.isDice
    ? `🎲 Both players — send the ${game.telegramEmoji} emoji now\\!`
    : gameKey === "rps"
      ? `🤜 Both players — pick your move via the buttons\\!`
      : INSTANT_GAMES2.includes(gameKey)
        ? `${game.emoji} Resolving now\\.\\.\\.`
        : `🪙 Coin is flipping\\.\\.\\.`;

  return `
${game.emoji} *PvP Battle Started\\!*

🎮 *Game:* ${game.name}
💰 *Pot:* ${mv2Num(Number(bet.amount) * 2)}
⚔️ *${c1}* vs *${c2}*

${instrLine}
`.trim();
}

export function betResultMessage(
  bet: Bet,
  creatorDisplayName: string,
  challengerDisplayName: string,
  winnerDisplayName: string | null,
  gameKey: GameType,
) {
  const game = GAMES[gameKey];
  const isTie = !winnerDisplayName;
  const c1 = esc(creatorDisplayName);
  const c2 = esc(challengerDisplayName);

  const resultLine = isTie
    ? "🤝 *It's a Tie\\! Both players refunded\\.*"
    : `🏆 *${esc(winnerDisplayName!)} wins ${mv2Num(Number(bet.amount) * 2)}\\!*`;

  const cardStr = (n: number) => n === 1 ? "A" : n === 11 ? "J" : n === 12 ? "Q" : n === 13 ? "K" : `${n}`;
  let scoresLine = "";

  if (gameKey === "coinflip") {
    scoresLine = `🪙 Coin: *${bet.creatorScore === 1 ? "🌕 Heads" : "🌑 Tails"}*\n👤 ${c1} → ${bet.creatorChoice === "heads" ? "🌕 Heads" : "🌑 Tails"}\n👤 ${c2} → ${bet.challengerChoice === "heads" ? "🌕 Heads" : "🌑 Tails"}`;
  } else if (gameKey === "rps") {
    const emojiMap: Record<string, string> = { rock: "🪨 Rock", paper: "📄 Paper", scissors: "✂️ Scissors" };
    scoresLine = `👤 ${c1}: *${emojiMap[bet.creatorChoice || ""] || "?"}*\n👤 ${c2}: *${emojiMap[bet.challengerChoice || ""] || "?"}*`;
  } else if (gameKey === "highcard") {
    scoresLine = `🃏 Cards drawn:\n👤 ${c1}: *${cardStr(bet.creatorScore ?? 0)}* \\(${bet.creatorScore}\\)\n👤 ${c2}: *${cardStr(bet.challengerScore ?? 0)}* \\(${bet.challengerScore}\\)`;
  } else if (gameKey === "baccarat") {
    const playerLabel = bet.creatorChoice === "player" ? c1 : c2;
    const bankerLabel = bet.creatorChoice === "player" ? c2 : c1;
    scoresLine = `🀄 Player: *${bet.creatorScore ?? "?"}* \\| Banker: *${bet.challengerScore ?? "?"}*\n🎰 ${playerLabel} → Player \\| 🏦 ${bankerLabel} → Banker`;
  } else if (gameKey === "dragon") {
    const card = bet.creatorScore ?? 0;
    const resultSide = card >= 7 ? "🐉 Dragon" : "🐯 Tiger";
    scoresLine = `🐉 Card drawn: *${card}* → *${resultSide}*\n👤 ${c1} → ${bet.creatorChoice === "dragon" ? "🐉 Dragon" : "🐯 Tiger"} \\| 👤 ${c2} → ${bet.challengerChoice === "dragon" ? "🐉 Dragon" : "🐯 Tiger"}`;
  } else if (gameKey === "evenodd") {
    const roll = bet.creatorScore ?? 0;
    const parity = roll % 2 === 0 ? "2️⃣ Even" : "1️⃣ Odd";
    scoresLine = `⚡ Die rolled: *${roll}* → *${parity}*\n👤 ${c1} → ${bet.creatorChoice === "even" ? "2️⃣ Even" : "1️⃣ Odd"} \\| 👤 ${c2} → ${bet.challengerChoice === "even" ? "2️⃣ Even" : "1️⃣ Odd"}`;
  } else if (gameKey === "lucky7") {
    const d1 = Math.abs(7 - (bet.creatorScore ?? 0));
    const d2 = Math.abs(7 - (bet.challengerScore ?? 0));
    scoresLine = `🔢 Closest to 7:\n👤 ${c1}: *${bet.creatorScore ?? "?"}* \\(±${d1}\\)\n👤 ${c2}: *${bet.challengerScore ?? "?"}* \\(±${d2}\\)`;
  } else if (gameKey === "wheel") {
    scoresLine = `🎡 Wheel results:\n👤 ${c1}: *${bet.creatorScore ?? "?"}*\n👤 ${c2}: *${bet.challengerScore ?? "?"}*`;
  } else {
    scoresLine = `📊 Scores:\n👤 ${c1}: *${bet.creatorScore ?? "?"}*\n👤 ${c2}: *${bet.challengerScore ?? "?"}*`;
  }

  return `
${game.emoji} *Game Over — ${game.name}*

${resultLine}

${scoresLine}
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard & Wallet
// ─────────────────────────────────────────────────────────────────────────────

export function leaderboardMessage(users: User[]) {
  const medals = ["🥇", "🥈", "🥉"];
  const rows = users.map((u, i) => {
    const medal = medals[i] || `${i + 1}\\.`;
    const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User\\#${u.telegramId}`);
    const streak = (u as any).bestStreak > 2 ? ` 🔥${(u as any).bestStreak}` : "";
    return `${medal} *${name}* — ${mv2Num(u.totalWon)} \\(${u.totalWins}W / ${u.totalLosses}L\\)${streak}`;
  }).join("\n");

  return `
🏆 *Casino Leaderboard*

${rows || "No players yet\\!"}

_Rankings by total coins won_
`.trim();
}

export function walletMessage(user: User, txs: Transaction[]) {
  const name = safeName(user.firstName) || "Player";
  const header = `📜 *Wallet — ${name}*\n\n💰 *Balance:* ${mv2Num(user.balance)}\n\n*Recent Transactions:*\n`;

  if (txs.length === 0) return header + "_No transactions yet_";

  const typeEmoji: Record<string, string> = {
    bet_placed:   "💸",
    bet_win:      "🏆",
    daily_bonus:  "🎁",
    refund:       "↩️",
    admin_adjust: "⚙️",
    deposit:      "💳",
    star_refund:  "⭐",
  };

  const rows = txs.map(tx => {
    const amt = parseFloat(tx.amount as string);
    const sign = amt >= 0 ? "\\+" : "\\-";
    const absFormatted = Math.abs(amt).toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/\./g, "\\.");
    const amountStr = `${sign}🪙 ${absFormatted}`;
    const emoji = typeEmoji[tx.type] || "💱";
    const desc = tx.description ? ` _${esc(tx.description)}_` : "";
    const date = tx.createdAt
      ? new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "";
    return `${emoji} ${amountStr}${desc} \\[${esc(date)}\\]`;
  }).join("\n");

  return header + rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

export function adminPanelMessage(stats: { users: number; bets: number; volume: number }) {
  return `
⚙️ *Admin Control Panel*

👥 Total Users: *${stats.users.toLocaleString()}*
🎮 Total Bets: *${stats.bets.toLocaleString()}*
💰 Total Volume: *${mv2Num(stats.volume)}*

_Select an action below:_
`.trim();
}
