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

Hello, ${name}\\! Balance: *${formatBalance(user.balance)}*

*🎮 Quick Bet Shortcuts:*
\`/dice 100\` — 🎲 Dice
\`/darts 100\` — 🎯 Darts
\`/football 100\` — ⚽ Football
\`/bowling 100\` — 🎳 Bowling
\`/basketball 100\` — 🏀 Basketball

Replace \`100\` with any amount you want to bet\\.
Or use the buttons below — tap a game emoji for quick access\\!

🎲 🎯 ⚽ 🎳 🏀
`.trim();
}

export function helpMessage() {
  return `
🎰 *PvP Casino Bot — Help*

*📌 Commands:*
/start — Main menu & balance
/play — Choose game & bet amount
/dice \\[amount\\] — Quick dice bet
/darts \\[amount\\] — Quick darts bet
/football \\[amount\\] — Quick football bet
/bowling \\[amount\\] — Quick bowling bet
/basketball \\[amount\\] — Quick basketball bet
/bets — Active bets in this chat
/stats — Your stats & history
/leaderboard — Top players
/daily — Daily bonus \\(${formatBalance(500)}\\)
/help — This message
/adminpanel — Admin panel \\(admins only\\)

*🎮 Games:*
🎲 *Dice* — Highest roll \\(1\\-6\\) wins
🎯 *Darts* — Highest throw \\(1\\-6\\) wins
⚽ *Football* — Highest score \\(0\\-5\\) wins
🎳 *Bowling* — Highest pins \\(0\\-6\\) wins
🏀 *Basketball* — Highest shot \\(0\\-5\\) wins

*💡 How to Play:*
1\\. Create a bet with /play or a shortcut
2\\. Wait for someone to tap Accept
3\\. Both players send the game emoji
4\\. Highest score wins the full pot\\!

*🎯 Tie:* Both players are fully refunded

*⚠️ Rules:*
→ Min bet: ${formatBalance(MIN_BET)} \\| Max: ${formatBalance(MAX_BET)}
→ Bets expire after 10 min if unchallenged
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

⏱ Expires in 10 minutes\\.
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

🎲 Both players — send the ${game.telegramEmoji} emoji now\\!
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
