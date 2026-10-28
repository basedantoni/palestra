import { initTRPC, TRPCError } from "@trpc/server";

import { env } from "@life-tracker/env/server";

import type { Context } from "./context";
import { parseAdminEmails } from "./lib/admins";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const email = ctx.session.user?.email?.toLowerCase();
  if (!email || !adminEmails.includes(email)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
      cause: "User is not an admin",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});
