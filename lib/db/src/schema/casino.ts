import { pgTable, serial, bigint, text, integer, boolean, timestamp, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gameTypeEnum = pgEnum("game_type", [
  "dice", "darts", "football", "bowling", "basketball",
  "slots", "coinflip", "rps",
  "highcard", "baccarat", "dragon", "evenodd", "lucky7", "wheel",
]);
export const betStatusEnum = pgEnum("bet_status", ["pending", "active", "completed", "cancelled", "expired"]);
export const withdrawStatusEnum = pgEnum("withdraw_status", ["pending", "approved", "rejected"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull().default("1000"),
  totalWins: integer("total_wins").notNull().default(0),
  totalLosses: integer("total_losses").notNull().default(0),
  totalBets: integer("total_bets").notNull().default(0),
  totalWagered: numeric("total_wagered", { precision: 18, scale: 2 }).notNull().default("0"),
  totalWon: numeric("total_won", { precision: 18, scale: 2 }).notNull().default("0"),
  currentStreak: integer("current_streak").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  totalDeposited: numeric("total_deposited", { precision: 18, scale: 2 }).notNull().default("0"),
  totalWithdrawn: integer("total_withdrawn").notNull().default(0), // in stars
  lastDailyAt: timestamp("last_daily_at"),
  isBanned: boolean("is_banned").notNull().default(false),
  banReason: text("ban_reason"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
});

export const betsTable = pgTable("bets", {
  id: serial("id").primaryKey(),
  creatorId: bigint("creator_id", { mode: "number" }).notNull(),
  challengerId: bigint("challenger_id", { mode: "number" }),
  gameType: gameTypeEnum("game_type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  status: betStatusEnum("status").notNull().default("pending"),
  creatorScore: integer("creator_score"),
  challengerScore: integer("challenger_score"),
  creatorChoice: text("creator_choice"),
  challengerChoice: text("challenger_choice"),
  winnerId: bigint("winner_id", { mode: "number" }),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  messageId: integer("message_id"),
  creatorDiceMessageId: integer("creator_dice_message_id"),
  challengerDiceMessageId: integer("challenger_dice_message_id"),
  expiresAt: timestamp("expires_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  type: text("type").notNull(),
  description: text("description"),
  betId: integer("bet_id"),
  balanceBefore: numeric("balance_before", { precision: 18, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Stars deposit log (for refund reference)
export const depositsTable = pgTable("deposits", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  stars: integer("stars").notNull(),
  coinsAwarded: numeric("coins_awarded", { precision: 18, scale: 2 }).notNull(),
  telegramChargeId: text("telegram_charge_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Withdrawal requests
export const withdrawRequestsTable = pgTable("withdraw_requests", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  coinsDeducted: numeric("coins_deducted", { precision: 18, scale: 2 }).notNull(),
  starsRequested: integer("stars_requested").notNull(),
  status: withdrawStatusEnum("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, lastActiveAt: true });
export const insertBetSchema = createInsertSchema(betsTable).omit({ id: true, createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });

export type User = typeof usersTable.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Bet = typeof betsTable.$inferSelect;
export type InsertBet = z.infer<typeof insertBetSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
export type WithdrawRequest = typeof withdrawRequestsTable.$inferSelect;
