import { db } from "@workspace/db";
import { usersTable, betsTable, transactionsTable } from "@workspace/db/schema";
import { eq, desc, sql, and, or } from "drizzle-orm";
import { STARTING_BALANCE, BET_EXPIRY_MINUTES } from "./config.js";
import { getLevel, levelProgress, levelUpReward, XP_REWARDS, type XPEvent } from "./levels.js";

const WEEKLY_BONUS_COINS = 2_500;
const WEEKLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const REFERRAL_REWARD_REFERRER = 1_000;
const REFERRAL_REWARD_NEW = 500;

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

/** Update win/loss streaks after a game result + award XP */
export async function updateStreaks(winnerId: number | null, loserId: number | null) {
  if (winnerId) {
    const w = await getUserByTelegramId(winnerId);
    if (w) {
      const newStreak = ((w as any).currentStreak || 0) + 1;
      const bestStreak = Math.max((w as any).bestStreak || 0, newStreak);
      await db.update(usersTable).set({ currentStreak: newStreak, bestStreak } as any)
        .where(eq(usersTable.telegramId, winnerId));
    }
    awardXP(winnerId, "win").catch(() => {});
  }
  if (loserId) {
    await db.update(usersTable).set({ currentStreak: 0 } as any).where(eq(usersTable.telegramId, loserId));
    awardXP(loserId, "loss").catch(() => {});
  }
}

/** Award tie XP to both players */
export async function awardTieXP(creatorId: number, challengerId: number | null) {
  awardXP(creatorId, "tie").catch(() => {});
  if (challengerId) awardXP(challengerId, "tie").catch(() => {});
}

export async function createBet(
  creatorId: number,
  gameType: string,
  amount: number,
  chatId: number,
  messageId?: number,
  creatorChoice?: string,
) {
  const expiresAt = new Date(Date.now() + BET_EXPIRY_MINUTES * 60 * 1000);

  const inserted = await db.insert(betsTable).values({
    creatorId,
    gameType: gameType as any,
    amount: amount.toString(),
    status: "pending",
    chatId,
    messageId: messageId || null,
    expiresAt,
    creatorChoice: creatorChoice || null,
  } as any).returning();

  // Award XP for creating a bet (fire-and-forget)
  awardXP(creatorId, "bet_created").catch(() => {});

  return inserted[0];
}

export async function getBet(betId: number) {
  const bets = await db.select().from(betsTable).where(eq(betsTable.id, betId)).limit(1);
  return bets[0] || null;
}

export async function getUserPendingBetsCount(telegramId: number): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` })
    .from(betsTable)
    .where(and(eq(betsTable.creatorId, telegramId), eq(betsTable.status, "pending")));
  return result[0]?.count ?? 0;
}

export async function getActiveBets(chatId: number) {
  return db.select().from(betsTable).where(
    and(eq(betsTable.chatId, chatId), or(eq(betsTable.status, "pending"), eq(betsTable.status, "active")))
  ).orderBy(desc(betsTable.createdAt)).limit(10);
}

export async function updateBetStatus(betId: number, updates: Record<string, any>) {
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

export async function getUserTransactions(telegramId: number, limit = 15) {
  return db.select().from(transactionsTable)
    .where(eq(transactionsTable.userId, telegramId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit);
}

/** Get user's own pending/active bets (as creator) across all chats */
export async function getUserActiveBets(telegramId: number) {
  return db.select().from(betsTable).where(
    and(
      eq(betsTable.creatorId, telegramId),
      or(eq(betsTable.status, "pending"), eq(betsTable.status, "active"))
    )
  ).orderBy(desc(betsTable.createdAt)).limit(15);
}

/** Cancel a pending bet and refund coins to creator */
export async function cancelBetByCreator(betId: number, creatorId: number): Promise<{ ok: boolean; reason?: string; amount?: number }> {
  const bet = await getBet(betId);
  if (!bet) return { ok: false, reason: "Bet not found" };
  if (bet.creatorId !== creatorId) return { ok: false, reason: "Not your bet" };
  if (bet.status !== "pending") return { ok: false, reason: "Bet is already active or completed" };

  const amount = parseFloat(bet.amount as string);
  await db.update(betsTable).set({ status: "cancelled" } as any).where(eq(betsTable.id, betId));
  await updateBalance(creatorId, amount, "refund", `Cancelled bet #${betId} (${bet.gameType})`);
  return { ok: true, amount };
}

/** Award XP and handle level-ups. Returns level-up info if player leveled up. */
export async function awardXP(telegramId: number, event: XPEvent): Promise<{ leveled: boolean; newLevel: number; oldLevel: number; reward: number } | null> {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;

  const gain = XP_REWARDS[event];
  const oldXp = (user as any).xp as number ?? 0;
  const newXp = oldXp + gain;
  const oldLevel = getLevel(oldXp);
  const newLevel = getLevel(newXp);
  const leveled = newLevel > oldLevel;
  const reward = leveled ? levelUpReward(newLevel) : 0;

  const updates: Record<string, any> = { xp: newXp, level: newLevel };
  if (leveled && reward > 0) {
    const currentBal = parseFloat(user.balance as string);
    updates.balance = (currentBal + reward).toString();
  }

  await db.update(usersTable).set(updates as any).where(eq(usersTable.telegramId, telegramId));

  if (leveled && reward > 0) {
    await db.insert(transactionsTable).values({
      userId: telegramId,
      amount: reward.toString(),
      type: "level_up",
      description: `Level up! Reached level ${newLevel}`,
      balanceBefore: user.balance as string,
      balanceAfter: (parseFloat(user.balance as string) + reward).toString(),
    });
  }

  return { leveled, newLevel, oldLevel, reward };
}

/** Claim weekly bonus — returns coins awarded or null if on cooldown */
export async function claimWeeklyBonus(telegramId: number): Promise<{ ok: boolean; coins?: number; nextAt?: Date }> {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return { ok: false };

  const lastAt = (user as any).lastWeeklyAt as Date | null;
  const now = Date.now();
  if (lastAt && now - new Date(lastAt).getTime() < WEEKLY_COOLDOWN_MS) {
    const nextAt = new Date(new Date(lastAt).getTime() + WEEKLY_COOLDOWN_MS);
    return { ok: false, nextAt };
  }

  const before = parseFloat(user.balance as string);
  const after = before + WEEKLY_BONUS_COINS;
  await db.update(usersTable).set({
    balance: after.toString(),
    lastWeeklyAt: new Date(),
  } as any).where(eq(usersTable.telegramId, telegramId));

  await db.insert(transactionsTable).values({
    userId: telegramId,
    amount: WEEKLY_BONUS_COINS.toString(),
    type: "weekly_bonus",
    description: "Weekly bonus claimed",
    balanceBefore: before.toString(),
    balanceAfter: after.toString(),
  });

  return { ok: true, coins: WEEKLY_BONUS_COINS };
}

/** Apply referral on first join. Awards coins to both users. */
export async function applyReferral(newUserId: number, referrerId: number): Promise<{ ok: boolean; reason?: string }> {
  if (newUserId === referrerId) return { ok: false, reason: "Cannot refer yourself" };

  const newUser = await getUserByTelegramId(newUserId);
  if (!newUser) return { ok: false, reason: "User not found" };
  if ((newUser as any).referredBy) return { ok: false, reason: "Already referred" };

  const referrer = await getUserByTelegramId(referrerId);
  if (!referrer) return { ok: false, reason: "Referrer not found" };

  // Mark new user as referred
  await db.update(usersTable).set({ referredBy: referrerId } as any).where(eq(usersTable.telegramId, newUserId));

  // Reward new user
  const newBal = parseFloat(newUser.balance as string) + REFERRAL_REWARD_NEW;
  await db.update(usersTable).set({ balance: newBal.toString() } as any).where(eq(usersTable.telegramId, newUserId));
  await db.insert(transactionsTable).values({
    userId: newUserId,
    amount: REFERRAL_REWARD_NEW.toString(),
    type: "referral_bonus",
    description: `Referral bonus for joining via ${referrer.username || referrerId}`,
    balanceBefore: newUser.balance as string,
    balanceAfter: newBal.toString(),
  });

  // Reward referrer
  const refBal = parseFloat(referrer.balance as string) + REFERRAL_REWARD_REFERRER;
  await db.update(usersTable)
    .set({
      balance: refBal.toString(),
      totalReferrals: ((referrer as any).totalReferrals ?? 0) + 1,
    } as any)
    .where(eq(usersTable.telegramId, referrerId));
  await db.insert(transactionsTable).values({
    userId: referrerId,
    amount: REFERRAL_REWARD_REFERRER.toString(),
    type: "referral_reward",
    description: `Referral reward — ${newUser.username || newUserId} joined`,
    balanceBefore: referrer.balance as string,
    balanceAfter: refBal.toString(),
  });

  return { ok: true };
}
