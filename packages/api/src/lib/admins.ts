import type * as schema from "@life-tracker/db/schema/index";
import { notification, user } from "@life-tracker/db/schema/index";
import { inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** `ADMIN_EMAILS` as lowercased addresses. There is no admin role column: this list is the admins. */
export const parseAdminEmails = (raw: string | undefined) =>
  (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

type AdminNotification = {
  type: (typeof notification.$inferInsert)["type"];
  title: string;
  message: string;
  payload?: Record<string, unknown>;
};

/** One in-app notification per user whose email is in `adminEmails`; an email with no user is skipped. */
export async function notifyAdmins(db: PgDatabase<PgQueryResultHKT, typeof schema>, adminEmails: string[], n: AdminNotification) {
  if (adminEmails.length === 0) return;
  const admins = await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(sql`lower(${user.email})`, adminEmails));
  if (admins.length === 0) return;
  await db.insert(notification).values(admins.map(({ id }) => ({ id: crypto.randomUUID(), userId: id, ...n })));
}
