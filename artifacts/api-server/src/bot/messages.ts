import { GAMES, GameType, MIN_BET, MAX_BET, STARTING_BALANCE } from "./config.js";
import { safeName, esc } from "./escape.js";
import type { User, Bet, Transaction } from "@workspace/db/schema";

export function formatBalance(amount: string | number) {
  return `🪙 ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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
💰 Balance: *${formatBalance(user.balance)}*
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
/daily — Daily bonus \\(${formatBalance(500)}\\)
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

*🎯 Tie:* Both players are fully refunded
*⚠️ Bets expire in 10 min if unchallenged*
`.trim();
}

export function profileMessage(user: User, rank: number) {
  const winRate = user.totalBets > 0
    ? ((user.totalWins / user.totalBets) * 100).toFixed(1)
    : "0.0";

  const profit = parseFloat(user.totalWon as string) - parseFloat(user.totalWagered as string);
  const profitEmoji = profit >= 0 ? "📈" : "📉";
  const profitStr = `${profit >= 0 ? "\\+" : ""}${formatBalance(profit)}`;

  const name = safeName(user.firstName) || "Unknown";
  const usernameStr = user.username ? ` \\(@${esc(user.username)}\\)` : "";
  const streak = (user as any).currentStreak > 0
    ? `\n🔥 *Win Streak:* ${(user as any).currentStreak} \\(Best: ${(user as any).bestStreak}\\)` : "";

  return `
👤 *Player Profile*

*Name:* ${name}${usernameStr}
*ID:* \`${user.telegramId}\`
🏆 *Rank:* \\#${rank}${streak}

💰 *Balance:* ${formatBalance(user.balance)}
📊 *Win Rate:* ${winRate}%
${profitEmoji} *Profit/Loss:* ${profitStr}

🎮 *Total Bets:* ${user.totalBets}
✅ *Wins:* ${user.totalWins}
❌ *Losses:* ${user.totalLosses}
💵 *Total Wagered:* ${formatBalance(user.totalWagered)}
🏅 *Total Won:* ${formatBalance(user.totalWon)}
`.trim();
}

export function betCreatedMessage(bet: Bet, creatorDisplayName: string, gameKey: GameType) {
  const game = GAMES[gameKey];
  const safeCreator = esc(creatorDisplayName);
  const choiceNote = gameKey === "coinflip" && bet.creatorChoice
    ? `\n🪙 Creator picked: *${bet.creatorChoice === "heads" ? "🌕 Heads" : "🌑 Tails"}*`
    : "";
  const playNote = game.isDice
    ? `_Both players send ${game.telegramEmoji} after accepting_`
    : gameKey === "coinflip"
      ? `_Coin flips instantly when opponent accepts\\!_`
      : `_Both players pick via buttons after accepting\\!_`;

  return `
${game.emoji} *New PvP Bet — ${game.name}\\!*

💰 *Amount:* ${formatBalance(bet.amount)}
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
  const instrLine = game.isDice
    ? `🎲 Both players — send the ${game.telegramEmoji} emoji now\\!`
    : gameKey === "rps"
      ? `🤜 Both players — pick your move below\\!`
      : `🪙 Coin is in the air\\.\\.\\.`;

  return `
${game.emoji} *PvP Battle Started\\!*

🎮 *Game:* ${game.name}
💰 *Pot:* ${formatBalance(Number(bet.amount) * 2)}
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
    : `🏆 *${esc(winnerDisplayName!)} wins ${formatBalance(Number(bet.amount) * 2)}\\!*`;

  let scoresLine = "";
  if (gameKey === "coinflip") {
    scoresLine = `🪙 Result: *${bet.creatorScore === 1 ? "🌕 Heads" : "🌑 Tails"}*\n👤 ${c1} picked: ${bet.creatorChoice === "heads" ? "🌕 Heads" : "🌑 Tails"}\n👤 ${c2} picked: ${bet.challengerChoice === "heads" ? "🌕 Heads" : "🌑 Tails"}`;
  } else if (gameKey === "rps") {
    const emojiMap: Record<string, string> = { rock: "🪨", paper: "📄", scissors: "✂️" };
    scoresLine = `👤 ${c1}: ${emojiMap[bet.creatorChoice || ""] || "?"} ${bet.creatorChoice || "?"}\n👤 ${c2}: ${emojiMap[bet.challengerChoice || ""] || "?"} ${bet.challengerChoice || "?"}`;
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
    return `${medal} *${name}* — ${formatBalance(u.totalWon)} \\(${u.totalWins}W/${u.totalLosses}L\\)${streak}`;
  }).join("\n");

  return `
🏆 *Casino Leaderboard — Top Players*

${rows || "No players yet\\!"}

_Rankings based on total coins won_
`.trim();
}

export function walletMessage(user: User, txs: Transaction[]) {
  const name = safeName(user.firstName) || "Player";
  const header = `📜 *Wallet — ${name}*\n\n💰 *Balance:* ${formatBalance(user.balance)}\n\n*Recent Transactions:*\n`;

  if (txs.length === 0) return header + "_No transactions yet_";

  const typeEmoji: Record<string, string> = {
    bet_placed: "💸",
    bet_win: "🏆",
    daily_bonus: "🎁",
    refund: "↩️",
    admin_adjust: "⚙️",
  };

  const rows = txs.map(tx => {
    const sign = parseFloat(tx.amount as string) >= 0 ? "\\+" : "";
    const emoji = typeEmoji[tx.type] || "💱";
    const desc = tx.description ? ` _${esc(tx.description)}_` : "";
    const date = tx.createdAt ? new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    return `${emoji} ${sign}${formatBalance(tx.amount)}${desc} \\[${date}\\]`;
  }).join("\n");

  return header + rows;
}

export function adminPanelMessage(stats: { users: number; bets: number; volume: number }) {
  return `
⚙️ *Admin Control Panel*

📊 *Bot Statistics:*
👥 Total Users: ${stats.users.toLocaleString()}
🎮 Total Bets: ${stats.bets.toLocaleString()}
💰 Total Volume: ${formatBalance(stats.volume)}

*Use the buttons below to manage the bot:*
`.trim();
}
