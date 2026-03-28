# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains a Telegram PvP Casino Bot running on Express + Telegraf.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Bot framework**: Telegraf (Telegram Bot API)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Telegram Bot: @AdsRewardGameBot

### Features
- **14 PvP Games**: Dice, Darts, Football, Bowling, Basketball, Slots, Coinflip, RPS, High Card, Baccarat, Dragon Tiger, Even/Odd, Lucky 7, Wheel Spin
- **Coin Betting**: Starting balance 1000 coins, daily bonus, Telegram Stars deposit (1★=500 coins)
- **USDT Betting** (beta): Real-money bets via Cwallet TipBot (`/usdt` command, admin-only until `USDT_BETA=true`)
- **Stats & Leaderboard**: Per-player win/loss/profit tracking, global rankings, win streaks
- **Admin Panel**: `/adminpanel` — user management, ban/unban, balance adjustments (`/add` `/remove`), broadcast

### USDT Bet System (Cwallet TipBot)
- Command: `/usdt` in a group chat (hidden from public; only admins until `USDT_BETA=true`)
- Amounts: 0.02, 0.05, 0.10 USDT or custom
- House fee: 5% (configurable via `USDT_HOUSE_FEE` env var)
- Flow: create → tip → opponent joins+tips → game plays → winner gets payout via userbot
- Auto-detection: bot reads @CWalletBot messages (requires privacy mode OFF in groups)
- Auto-payout: GramJS userbot sends `/tip @winner amount USDT` to @CWalletBot
- If userbot not configured: admin payout instruction shown in chat

### USDT Env Vars
| Var | Required | Description |
|-----|----------|-------------|
| `USDT_BETA` | No | Set to `"true"` to enable for all users |
| `CASINO_ACCOUNT` | No | Casino Telegram username (default: `AdsRewardCasino`) |
| `CWALLET_BOT` | No | CWallet bot username (default: `CWalletBot`) |
| `TG_API_ID` | Payout | Telegram API ID for userbot |
| `TG_API_HASH` | Payout | Telegram API hash for userbot |
| `TG_SESSION` | Payout | GramJS StringSession (run `node scripts/gen-tg-session.mjs` once) |
| `USDT_HOUSE_FEE` | No | House fee % (default: `5`) |

### Bot Setup: Privacy Mode
For @CWalletBot tip detection to work, disable the bot's group privacy mode:
`@BotFather → /mybots → @AdsRewardGameBot → Bot Settings → Group Privacy → Disable`

### Commands
- `/start` — Welcome screen & main menu
- `/play` — Create a new bet
- `/bets` — View active bets in chat
- `/stats` — Player profile & history
- `/leaderboard` — Top players
- `/daily` — Claim daily bonus (500 coins)
- `/help` — Full help guide
- `/adminpanel` — Admin only: management panel

### Environment Variables Required
- `TELEGRAM_BOT_TOKEN` — From @BotFather
- `DATABASE_URL` — Automatically set by Replit PostgreSQL
- `ADMIN_IDS` — Optional: comma-separated admin Telegram IDs (e.g., `123456,789012`)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server + Telegram bot
│       └── src/bot/        # Bot logic
│           ├── index.ts          # Bot entry, launches Telegraf
│           ├── config.ts         # Game definitions, constants
│           ├── db.ts             # DB helper functions
│           ├── messages.ts       # Message formatting
│           ├── keyboards.ts      # Inline keyboard builders
│           └── handlers/
│               ├── start.ts      # /start, /help handlers
│               ├── play.ts       # /play, bet creation, accept/cancel
│               ├── game.ts       # Dice emoji detection, scoring
│               ├── stats.ts      # /stats, /leaderboard, /daily
│               └── admin.ts      # /adminpanel, user management
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/casino.ts  # Users, Bets, Transactions tables
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema

### Tables
- `users` — Telegram ID, balance, win/loss stats, ban/admin flags
- `bets` — Game type, amount, creator/challenger, scores, winner, status
- `transactions` — Full audit trail of all balance changes

### Game Flow
1. Player creates bet → `bets` record (status: pending), no funds deducted
2. Challenger accepts → funds deducted from both, status: active
3. Both send dice emoji → scores recorded
4. Winner determined → pot sent to winner, stats updated
5. Tie → both refunded

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build`
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly`
- `pnpm --filter @workspace/db run push` — push schema to DB

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server + Telegram bot. Bot is launched in `app.ts` via `bot.launch()`.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App: `src/app.ts` — mounts middleware, routes, and launches bot
- Bot: `src/bot/` — all Telegram bot logic

### `lib/db` (`@workspace/db`)

Database layer. Schema: `src/schema/casino.ts`.

- Run `pnpm --filter @workspace/db run push` after schema changes
