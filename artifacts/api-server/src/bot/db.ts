import { db } from "@workspace/db";
import { usersTable, betsTable, transactionsTable } from "@workspace/db/schema";
import { eq, desc, sql, and, or } from "drizzle-orm";
import { STARTING_BALANCE, BET_EXPIRY_MINUTES } from "./config.js";

export async function getOrCreateUser(telegramId: number, data: { username?: string; firstName?: string; lastName?: string }) {
  let user = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId)).limit(1);

  if (user.length === 0) {
    const inserted = await db.insert(usersTable).values({
      telegramId,
      username: data.username,
      firstName: data.firstName,
      lastName: data.lastName,
      balance: STARTING_BALANCE.toString(),
    }).returning();
    return inserted[0];
  }

  await db.update(usersTable).set({
    username: data.username,
    firstName: data.firstName,
    lastName: data.lastName,
    lastActiveAt: new Date(),
  }).where(eq(usersTable.telegramId, telegramId));

  return user[0];
}

export async function getUserByTelegramId(telegramId: number) {
  const users = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId)).limit(1);
  return users[0] || null;
}

export async function getUserById(id: number) {
  const users = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return users[0] || null;
}

export async function updateBalance(telegramId: number, delta: number, type: string, description: string, betId?: number) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) throw new Error("User not found");

  const before = parseFloat(user.balance as string);
  const after = before + delta;

  if (after < 0) throw new Error("Insufficient balance");

  await db.update(usersTable).set({ balance: after.toString() }).where(eq(usersTable.telegramId, telegramId));

  await db.insert(transactionsTable).values({
    userId: telegramId,
    amount: delta.toString(),
    type,
    description,
    betId: betId || null,
    balanceBefore: before.toString(),
    balanceAfter: after.toString(),
  });

  return after;
}

export async function createBet(creatorId: number, gameType: string, amount: number, chatId: number, messageId?: number) {
  const expiresAt = new Date(Date.now() + BET_EXPIRY_MINUTES * 60 * 1000);

  const inserted = await db.insert(betsTable).values({
    creatorId,
    gameType: gameType as any,
    amount: amount.toString(),
    status: "pending",
    chatId,
    messageId: messageId || null,
    expiresAt,
  }).returning();

  return inserted[0];
}

export async function getBet(betId: number) {
  const bets = await db.select().from(betsTable).where(eq(betsTable.id, betId)).limit(1);
  return bets[0] || null;
}

export async function getActiveBets(chatId: number) {
  return db.select().from(betsTable).where(
    and(eq(betsTable.chatId, chatId), or(eq(betsTable.status, "pending"), eq(betsTable.status, "active")))
  ).orderBy(desc(betsTable.createdAt)).limit(10);
}

export async function updateBetStatus(betId: number, updates: Partial<{
  status: "pending" | "active" | "completed" | "cancelled" | "expired";
  challengerId: number;
  creatorScore: number;
  challengerScore: number;
  winnerId: number;
  creatorDiceMessageId: number;
  challengerDiceMessageId: number;
  messageId: number;
  completedAt: Date;
}>) {
  await db.update(betsTable).set(updates as any).where(eq(betsTable.id, betId));
}

export async function getLeaderboard(limit = 10) {
  return db.select().from(usersTable)
    .orderBy(desc(usersTable.totalWon))
    .limit(limit);
}

export async function getUserStats(telegramId: number) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;

  const rank = await db.select({ count: sql<number>`count(*)` })
    .from(usersTable)
    .where(sql`CAST(total_won AS DECIMAL) > CAST(${user.totalWon} AS DECIMAL)`);

  return { ...user, rank: Number(rank[0].count) + 1 };
}

export async function getAllUsers(limit = 50, offset = 0) {
  return db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(limit).offset(offset);
}

export async function getUserCount() {
  const result = await db.select({ count: sql<number>`count(*)` }).from(usersTable);
  return Number(result[0].count);
}

export async function getTotalBetsCount() {
  const result = await db.select({ count: sql<number>`count(*)` }).from(betsTable);
  return Number(result[0].count);
}

export async function getTotalVolume() {
  const result = await db.select({ total: sql<string>`coalesce(sum(CAST(amount AS DECIMAL)), 0)` }).from(betsTable);
  return parseFloat(result[0].total || "0");
}

export async function banUser(telegramId: number, reason?: string) {
  await db.update(usersTable).set({ isBanned: true, banReason: reason || "Banned by admin" }).where(eq(usersTable.telegramId, telegramId));
}

export async function unbanUser(telegramId: number) {
  await db.update(usersTable).set({ isBanned: false, banReason: null }).where(eq(usersTable.telegramId, telegramId));
}

export async function setAdminBalance(telegramId: number, newBalance: number) {
  await db.update(usersTable).set({ balance: newBalance.toString() }).where(eq(usersTable.telegramId, telegramId));
}

export async function setUserAdmin(telegramId: number, isAdmin: boolean) {
  await db.update(usersTable).set({ isAdmin }).where(eq(usersTable.telegramId, telegramId));
}

export async function expireOldBets() {
  await db.update(betsTable).set({ status: "expired" }).where(
    and(eq(betsTable.status, "pending"), sql`expires_at < NOW()`)
  );
}

export async function getUserRecentBets(telegramId: number, limit = 5) {
  return db.select().from(betsTable).where(
    or(eq(betsTable.creatorId, telegramId), eq(betsTable.challengerId, telegramId))
  ).orderBy(desc(betsTable.createdAt)).limit(limit);
}
