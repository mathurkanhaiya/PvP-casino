import { GAMES, GameType, MIN_BET, MAX_BET, STARTING_BALANCE } from "./config.js";
import { safeName, esc } from "./escape.js";
import type { User, Bet } from "@workspace/db/schema";

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
  return `
🎰 *Welcome to PvP Casino Bot\\!*

Hello, ${name}\\! You're ready to play\\.

💰 *Your Balance:* ${formatBalance(user.balance)}
🎮 *Games:* 🎲 Dice • 🎯 Darts • ⚽ Football • 🎳 Bowling • 🏀 Basketball

*How it works:*
→ Create a bet and challenge other players
→ Both players roll/throw their game emoji
→ Highest score wins the entire pot\\!

Use the buttons below to get started 👇
`.trim();
}

export function helpMessage() {
  return `
🎰 *PvP Casino Bot — Help*

*📌 Commands:*
/start — Main menu & balance
/play — Create a new bet
/bets — View active bets in this chat
/stats — Your stats & history
/leaderboard — Top players
/daily — Claim daily bonus \\(${formatBalance(500)}\\)
/help — This message
/adminpanel — Admin panel \\(admins only\\)

*🎮 Games:*
🎲 *Dice* — Highest roll \\(1\\-6\\) wins
🎯 *Darts* — Highest throw \\(1\\-6\\) wins
⚽ *Football* — Highest score \\(0\\-5\\) wins
🎳 *Bowling* — Highest pins \\(0\\-6\\) wins
🏀 *Basketball* — Highest shot \\(0\\-5\\) wins

*💡 How to Play:*
1\\. Use /play to create a bet
2\\. Choose a game & bet amount
3\\. Wait for a challenger to accept
4\\. Both players send the game emoji
5\\. Highest score wins the pot\\!

*🎯 Tie:* Both players are fully refunded

*⚠️ Rules:*
→ Min bet: ${formatBalance(MIN_BET)} \\| Max bet: ${formatBalance(MAX_BET)}
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
  const profitStr = `${profit >= 0 ? "\\+" : ""}${formatBalance(profit)}`;

  const name = safeName(user.firstName) || "Unknown";
  const usernameStr = user.username ? ` \\(@${esc(user.username)}\\)` : "";

  return `
👤 *Player Profile*

*Name:* ${name}${usernameStr}
*ID:* \`${user.telegramId}\`
🏆 *Rank:* \\#${rank}

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
  return `
${game.emoji} *New PvP Bet Created\\!*

🎮 *Game:* ${game.name}
💰 *Amount:* ${formatBalance(bet.amount)}
👤 *Creator:* ${safeCreator}

_${esc(game.description)}_

⏱ This bet expires in 10 minutes\\.
Tap *Accept* to join the battle\\!
`.trim();
}

export function betActiveMessage(bet: Bet, creatorDisplayName: string, challengerDisplayName: string, gameKey: GameType) {
  const game = GAMES[gameKey];
  const c1 = esc(creatorDisplayName);
  const c2 = esc(challengerDisplayName);
  return `
${game.emoji} *PvP Battle Started\\!*

🎮 *Game:* ${game.name}
💰 *Pot:* ${formatBalance(Number(bet.amount) * 2)}
👤 *${c1}* vs 👤 *${c2}*

🎲 Both players — send the ${game.telegramEmoji} emoji to play\\!
The bot will automatically detect your scores\\.
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

  return `
${game.emoji} *Battle Result\\!*

🎮 *Game:* ${game.name}
${resultLine}

📊 *Scores:*
👤 ${c1}: *${bet.creatorScore ?? "?"}*
👤 ${c2}: *${bet.challengerScore ?? "?"}*
`.trim();
}

export function leaderboardMessage(users: User[]) {
  const medals = ["🥇", "🥈", "🥉"];
  const rows = users.map((u, i) => {
    const medal = medals[i] || `${i + 1}\\.`;
    const name = u.username ? `@${esc(u.username)}` : (safeName(u.firstName) || `User\\#${u.telegramId}`);
    return `${medal} *${name}* — ${formatBalance(u.totalWon)} won \\(${u.totalWins}W/${u.totalLosses}L\\)`;
  }).join("\n");

  return `
🏆 *Casino Leaderboard — Top Players*

${rows || "No players yet\\!"}

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
