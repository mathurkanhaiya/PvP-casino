import { GAMES, GameType, MIN_BET, MAX_BET, STARTING_BALANCE } from "./config.js";
import { safeName, esc } from "./escape.js";
import type { User, Bet, Transaction } from "@workspace/db/schema";

export function formatBalance(amount: string | number) {
  return `🪙 ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * Format a number safely for MarkdownV2:
 *  - escapes '.' (decimal point)
 *  - escapes '-' (negative sign)
 *  - escapes ',' is NOT needed (comma isn't special in MV2)
 */
export function mv2Num(amount: string | number): string {
  const n = Number(amount);
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
  // escape any dots that appear in the formatted number
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

export function welcomeMessage(user: User) {
  const name = safeName(user.firstName) || "Player";
  const streak = (user as any).currentStreak > 1 ? `🔥 *Win Streak: ${(user as any).currentStreak}*\n` : "";
  return `
🎰 *Welcome to PvP Casino Bot\\!*

Hello, ${name}\\!
💰 Balance: *${mv2Num(user.balance)}*
${streak}
*🎮 Quick Bet Shortcuts:*
\`/dice 100\` 🎲  \`/darts 100\` 🎯
\`/football 100\` ⚽  \`/bowling 100\` 🎳
\`/basketball 100\` 🏀  \`/slots 100\` 🎰
\`/coinflip 100\` 🪙  \`/rps 100\` 🤜

Tap a game button or use a shortcut to start\\!
`.trim();
}

export function helpMessage() {
  return `
🎰 *PvP Casino Bot — Help*

*📌 Commands:*
/start — Main menu & balance
/play — Choose game & create bet
/wallet — Transaction history
/bets — Active bets in this chat
/stats — Your stats & profile
/leaderboard — Top players
/daily — Daily bonus \\(🪙 500\\)
/deposit — Deposit with Telegram Stars
/help — This message
/adminpanel — Admin panel \\(admins only\\)

*⚡ Shortcut Commands:*
/dice /darts /football /bowling /basketball
/slots /coinflip /rps — all followed by amount
_Example: \`/slots 500\`_

*🎮 Dice Games \\(send emoji to play\\):*
🎲 *Dice* — Roll 1\\-6, highest wins
🎯 *Darts* — Throw 1\\-6, bullseye wins
⚽ *Football* — Score 0\\-5, highest wins
🎳 *Bowling* — Pins 0\\-6, strike wins
🏀 *Basketball* — Hoops 0\\-5, swish wins
🎰 *Slots* — Spin 1\\-64, jackpot at 64\\!

*🃏 Instant Games \\(no emoji needed\\):*
🪙 *Coin Flip* — Pick Heads or Tails; resolved instantly
🤜 *RPS* — Rock, Paper, or Scissors via buttons

*💡 How PvP works:*
1\\. Create a bet \\(pick game \\+ amount\\)
2\\. Share the chat — anyone can accept
3\\. Play out the game
4\\. Winner takes the full pot\\!

*⚠️ Note:* Bets must be created in a *group chat* so opponents can join\\!
*🎯 Tie:* Both players are fully refunded
`.trim();
}

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

  return `
👤 *Player Profile*

*Name:* ${name}${usernameStr}
*ID:* \`${user.telegramId}\`
🏆 *Rank:* \\#${rank}${streak}

💰 *Balance:* ${mv2Num(user.balance)}
📊 *Win Rate:* ${winRate}%
${profitEmoji} *Profit/Loss:* ${profitStr}

🎮 *Total Bets:* ${user.totalBets}
✅ *Wins:* ${user.totalWins}
❌ *Losses:* ${user.totalLosses}
💵 *Total Wagered:* ${mv2Num(user.totalWagered)}
🏅 *Total Won:* ${mv2Num(user.totalWon)}
`.trim();
}

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
  const choiceNote = choiceLabel
    ? `\n${game.emoji} Creator picked: *${choiceLabel}*`
    : "";
  const INSTANT_GAMES = ["highcard", "baccarat", "dragon", "evenodd", "lucky7", "wheel"];
  const playNote = game.isDice
    ? `_Both players send ${game.telegramEmoji} after accepting_`
    : gameKey === "rps"
      ? `_Both players pick via buttons after accepting\\!_`
      : INSTANT_GAMES.includes(gameKey)
        ? `_Resolves instantly when opponent accepts\\!_`
        : `_Coin flips instantly when opponent accepts\\!_`;

  return `
${game.emoji} *New PvP Bet — ${game.name}\\!*

💰 *Amount:* ${mv2Num(bet.amount)}
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
      ? `🤜 Both players — pick your move below\\!`
      : INSTANT_GAMES2.includes(gameKey)
        ? `${game.emoji} Resolving now\\.\\.\\.`
        : `🪙 Coin is in the air\\.\\.\\.`;

  return `
${game.emoji} *PvP Battle Started\\!*

🎮 *Game:* ${game.name}
💰 *Pot:* ${mv2Num(Number(bet.amount) * 2)}
👤 *${c1}* vs 👤 *${c2}*

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
    ? "🤝 *It's a tie\\! Both players refunded\\!*"
    : `🏆 *${esc(winnerDisplayName!)} wins ${mv2Num(Number(bet.amount) * 2)}\\!*`;

  const cardStr = (n: number) => n === 1 ? "A" : n === 11 ? "J" : n === 12 ? "Q" : n === 13 ? "K" : `${n}`;
  let scoresLine = "";
  if (gameKey === "coinflip") {
    scoresLine = `🪙 Result: *${bet.creatorScore === 1 ? "🌕 Heads" : "🌑 Tails"}*\n👤 ${c1} picked: ${bet.creatorChoice === "heads" ? "🌕 Heads" : "🌑 Tails"}\n👤 ${c2} picked: ${bet.challengerChoice === "heads" ? "🌕 Heads" : "🌑 Tails"}`;
  } else if (gameKey === "rps") {
    const emojiMap: Record<string, string> = { rock: "🪨", paper: "📄", scissors: "✂️" };
    scoresLine = `👤 ${c1}: ${emojiMap[bet.creatorChoice || ""] || "?"} ${bet.creatorChoice || "?"}\n👤 ${c2}: ${emojiMap[bet.challengerChoice || ""] || "?"} ${bet.challengerChoice || "?"}`;
  } else if (gameKey === "highcard") {
    scoresLine = `🃏 Cards drawn:\n👤 ${c1}: *${cardStr(bet.creatorScore ?? 0)}* \\(${bet.creatorScore ?? "?"}\\)\n👤 ${c2}: *${cardStr(bet.challengerScore ?? 0)}* \\(${bet.challengerScore ?? "?"}\\)`;
  } else if (gameKey === "baccarat") {
    const playerLabel = c1 && bet.creatorChoice === "player" ? c1 : c2;
    const bankerLabel = c1 && bet.creatorChoice === "player" ? c2 : c1;
    scoresLine = `🀄 *Player: ${bet.creatorScore ?? "?"}* \\| *Banker: ${bet.challengerScore ?? "?"}*\n🎰 ${playerLabel} → Player \\| 🏦 ${bankerLabel} → Banker`;
  } else if (gameKey === "dragon") {
    const card = bet.creatorScore ?? 0;
    const resultSide = card >= 7 ? "🐉 Dragon" : "🐯 Tiger";
    const pickedC1 = bet.creatorChoice === "dragon" ? "🐉 Dragon" : "🐯 Tiger";
    const pickedC2 = bet.challengerChoice === "dragon" ? "🐉 Dragon" : "🐯 Tiger";
    scoresLine = `🐉 Card drawn: *${card}* → *${resultSide} wins\\!*\n👤 ${c1} → ${pickedC1} \\| 👤 ${c2} → ${pickedC2}`;
  } else if (gameKey === "evenodd") {
    const roll = bet.creatorScore ?? 0;
    const parity = roll % 2 === 0 ? "2️⃣ Even" : "1️⃣ Odd";
    const pickedC1 = bet.creatorChoice === "even" ? "2️⃣ Even" : "1️⃣ Odd";
    const pickedC2 = bet.challengerChoice === "even" ? "2️⃣ Even" : "1️⃣ Odd";
    scoresLine = `⚡ Die rolled: *${roll}* → *${parity}\\!*\n👤 ${c1} → ${pickedC1} \\| 👤 ${c2} → ${pickedC2}`;
  } else if (gameKey === "lucky7") {
    const d1 = Math.abs(7 - (bet.creatorScore ?? 0));
    const d2 = Math.abs(7 - (bet.challengerScore ?? 0));
    scoresLine = `🔢 Closest to 7:\n👤 ${c1}: *${bet.creatorScore ?? "?"}* \\(Δ${d1}\\)\n👤 ${c2}: *${bet.challengerScore ?? "?"}* \\(Δ${d2}\\)`;
  } else if (gameKey === "wheel") {
    scoresLine = `🎡 Wheel results:\n👤 ${c1}: *${bet.creatorScore ?? "?"}*\n👤 ${c2}: *${bet.challengerScore ?? "?"}*`;
  } else {
    scoresLine = `📊 *Scores:*\n👤 ${c1}: *${bet.creatorScore ?? "?"}*\n👤 ${c2}: *${bet.challengerScore ?? "?"}*`;
  }

  return `
${game.emoji} *Battle Result\\!*

🎮 *Game:* ${game.name}
${resultLine}

${scoresLine}
`.trim();
}

export function leaderboardMessage(users: User[]) {
  const medals = ["🥇", "🥈", "🥉"];
  const rows = users.map((u, i) => {
    const medal = medals[i] || `${i + 1}\\.`;
    const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User\\#${u.telegramId}`);
    const streak = (u as any).bestStreak > 2 ? ` 🔥${(u as any).bestStreak}` : "";
    return `${medal} *${name}* — ${mv2Num(u.totalWon)} \\(${u.totalWins}W/${u.totalLosses}L\\)${streak}`;
  }).join("\n");

  return `
🏆 *Casino Leaderboard — Top Players*

${rows || "No players yet\\!"}

_Rankings based on total coins won_
`.trim();
}

export function walletMessage(user: User, txs: Transaction[]) {
  const name = safeName(user.firstName) || "Player";
  const header = `📜 *Wallet — ${name}*\n\n💰 *Balance:* ${mv2Num(user.balance)}\n\n*Recent Transactions:*\n`;

  if (txs.length === 0) return header + "_No transactions yet_";

  const typeEmoji: Record<string, string> = {
    bet_placed:      "💸",
    bet_win:         "🏆",
    daily_bonus:     "🎁",
    refund:          "↩️",
    admin_adjust:    "⚙️",
    deposit:         "💳",
  };

  const rows = txs.map(tx => {
    const amt = parseFloat(tx.amount as string);
    const sign = amt >= 0 ? "\\+" : "\\-";
    const absFormatted = Math.abs(amt).toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/\./g, "\\.");
    const amountStr = `${sign}🪙 ${absFormatted}`;
    const emoji = typeEmoji[tx.type] || "💱";
    const desc = tx.description ? ` _${esc(tx.description)}_` : "";
    const date = tx.createdAt ? new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    return `${emoji} ${amountStr}${desc} \\[${esc(date)}\\]`;
  }).join("\n");

  return header + rows;
}

export function adminPanelMessage(stats: { users: number; bets: number; volume: number }) {
  return `
⚙️ *Admin Control Panel*

📊 *Bot Statistics:*
👥 Total Users: ${stats.users.toLocaleString()}
🎮 Total Bets: ${stats.bets.toLocaleString()}
💰 Total Volume: ${mv2Num(stats.volume)}

*Use the buttons below to manage the bot:*
`.trim();
}
