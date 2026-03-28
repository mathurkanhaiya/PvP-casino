import { pgTable, serial, bigint, text, integer, boolean, timestamp, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gameTypeEnum = pgEnum("game_type", ["dice", "darts", "football", "bowling", "basketball", "slots"]);
export const betStatusEnum = pgEnum("bet_status", ["pending", "active", "completed", "cancelled", "expired"]);

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

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, lastActiveAt: true });
export const insertBetSchema = createInsertSchema(betsTable).omit({ id: true, createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });

export type User = typeof usersTable.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Bet = typeof betsTable.$inferSelect;
export type InsertBet = z.infer<typeof insertBetSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
