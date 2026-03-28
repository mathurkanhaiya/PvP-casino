# Railway Environment Variables

Set these in your Railway project dashboard under **Variables**.

## Required

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from @BotFather |
| `DATABASE_URL` | PostgreSQL connection string (add Railway PostgreSQL plugin) |
| `SESSION_SECRET` | Any random long string (e.g. 64 random chars) |
| `ADMIN_IDS` | Your Telegram user ID, e.g. `2139807311` |
| `PORT` | Set to `8080` (Railway also sets this automatically) |
| `WEBHOOK_DOMAIN` | **Your Railway public domain** — e.g. `your-casino-bot-production.up.railway.app` (enables webhook mode, much more reliable than polling) |

## USDT Payouts (auto-payout via @cctip_bot)

| Variable | Description |
|----------|-------------|
| `TG_API_ID` | `38239977` |
| `TG_API_HASH` | Your Telegram API hash (from my.telegram.org) |
| `TG_PHONE` | `+919992055970` |
| `TG_SESSION` | GramJS session string — generate with `/usdt_setup` command in bot DM |
| `CASINO_ACCOUNT` | `AdsRewardCasino` |
| `CWALLET_BOT` | `cctip_bot` |
| `USDT_HOUSE_FEE` | `5` (percent, optional) |
| `USDT_BETA` | `true` to enable USDT bets for all users (omit = admin only) |

## Optional

| Variable | Description |
|----------|-------------|
| `COINS_PER_STAR` | `500` (how many coins per Telegram Star deposit) |
| `NODE_ENV` | `production` |

## Database Migration

Migrations run **automatically** on every deploy (the start command runs `push-force` before starting the bot). No manual step needed.
