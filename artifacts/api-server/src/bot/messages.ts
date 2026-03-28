import { GAMES, GameType, BET_AMOUNTS, MIN_BET, MAX_BET, STARTING_BALANCE } from "./config.js";
import type { User, Bet } from "@workspace/db/schema";

export function formatBalance(amount: string | number) {
  return `🪙 ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function formatUser(user: User) {
  if (user.username) return `@${user.username}`;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || `User#${user.telegramId}`;
}

export function welcomeMessage(user: User) {
  return `
🎰 *Welcome to PvP Casino Bot!*

Hello, ${user.firstName || "Player"}! You're ready to play!

💰 *Your Balance:* ${formatBalance(user.balance)}
🎮 *Games Available:* ${Object.values(GAMES).map(g => g.emoji + " " + g.name).join(" • ")}

*How it works:*
→ Create a bet and challenge other players
→ Both players roll/throw their game emoji
→ Highest score wins the pot!

Use the buttons below to get started 👇
`.trim();
}

export function helpMessage() {
  const gameList = Object.entries(GAMES).map(([key, g]) =>
    `${g.emoji} *${g.name}* — ${g.description}`
  ).join("\n");

  return `
🎰 *PvP Casino Bot — Help*

*📌 Commands:*
/start — Main menu & balance
/play — Create a new bet
/bets — View active bets in this chat
/stats — Your stats & history
/leaderboard — Top players
/daily — Claim daily bonus (${formatBalance(500)})
/help — This message

*🎮 Games:*
${gameList}

*💡 How to Play:*
1. Use /play to create a bet
2. Choose a game & bet amount
3. Share the bet or wait for a challenger
4. Both players roll — highest score wins!
5. Winner gets the full pot!

*🎯 Tie Rules:*
→ In case of a tie, the bet is refunded to both players

*⚠️ Rules:*
→ Min bet: ${formatBalance(MIN_BET)}
→ Max bet: ${formatBalance(MAX_BET)}
→ Bets expire after 10 minutes if unchallenged
→ New players start with ${formatBalance(STARTING_BALANCE)}
`.trim();
}

export function profileMessage(user: User, rank: number) {
  const winRate = user.totalBets > 0
    ? ((user.totalWins / user.totalBets) * 100).toFixed(1)
    : "0.0";

  const profit = parseFloat(user.totalWon as string) - parseFloat(user.totalWagered as string);
  const profitEmoji = profit >= 0 ? "📈" : "📉";

  return `
👤 *Player Profile*

*Name:* ${user.firstName || "Unknown"} ${user.username ? `(@${user.username})` : ""}
*ID:* \`${user.telegramId}\`
🏆 *Rank:* #${rank}

💰 *Balance:* ${formatBalance(user.balance)}
📊 *Win Rate:* ${winRate}%
${profitEmoji} *Profit/Loss:* ${profit >= 0 ? "+" : ""}${formatBalance(profit)}

🎮 *Total Bets:* ${user.totalBets}
✅ *Wins:* ${user.totalWins}
❌ *Losses:* ${user.totalLosses}
💵 *Total Wagered:* ${formatBalance(user.totalWagered)}
🏅 *Total Won:* ${formatBalance(user.totalWon)}
`.trim();
}

export function betCreatedMessage(bet: Bet, creatorName: string, gameKey: GameType) {
  const game = GAMES[gameKey];
  return `
${game.emoji} *New PvP Bet Created!*

🎮 *Game:* ${game.name}
💰 *Amount:* ${formatBalance(bet.amount)}
👤 *Creator:* ${creatorName}

*${game.description}*

⏱ This bet expires in 10 minutes.
Tap *Accept* to join the battle!
`.trim();
}

export function betActiveMessage(bet: Bet, creatorName: string, challengerName: string, gameKey: GameType) {
  const game = GAMES[gameKey];
  return `
${game.emoji} *PvP Battle Started!*

🎮 *Game:* ${game.name}
💰 *Pot:* ${formatBalance(Number(bet.amount) * 2)}
👤 vs 👤 *${creatorName}* vs *${challengerName}*

🎲 Both players — send the ${game.telegramEmoji} emoji to play!
The bot will automatically detect your scores.
`.trim();
}

export function betResultMessage(
  bet: Bet,
  creatorName: string,
  challengerName: string,
  winnerName: string | null,
  gameKey: GameType,
) {
  const game = GAMES[gameKey];
  const isTie = !winnerName;

  let resultLine = isTie
    ? "🤝 *It's a tie! Both players refunded!*"
    : `🏆 *${winnerName} wins ${formatBalance(Number(bet.amount) * 2)}!*`;

  return `
${game.emoji} *Battle Result!*

🎮 *Game:* ${game.name}
${resultLine}

📊 *Scores:*
👤 ${creatorName}: *${bet.creatorScore ?? "?"}*
👤 ${challengerName}: *${bet.challengerScore ?? "?"}*
`.trim();
}

export function leaderboardMessage(users: User[]) {
  const medals = ["🥇", "🥈", "🥉"];
  const rows = users.map((u, i) => {
    const medal = medals[i] || `${i + 1}.`;
    const name = u.username ? `@${u.username}` : (u.firstName || `User#${u.telegramId}`);
    return `${medal} *${name}* — ${formatBalance(u.totalWon)} won (${u.totalWins}W/${u.totalLosses}L)`;
  }).join("\n");

  return `
🏆 *Casino Leaderboard — Top Players*

${rows || "No players yet!"}

_Rankings based on total coins won_
`.trim();
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
