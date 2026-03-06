import type { Context as HonoContext } from "hono";

import { auth } from "@src/auth";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: new Headers(context.req.header()),
  });
  return {
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
