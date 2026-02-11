import { protectedProcedure, publicProcedure, router } from "../index";
import { analyticsRouter } from "./analytics";
import { adminRouter } from "./admin";
import { exercisesRouter } from "./exercises";
import { preferencesRouter } from "./preferences";
import { templatesRouter } from "./templates";
import { workoutsRouter } from "./workouts";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  preferences: preferencesRouter,
  exercises: exercisesRouter,
  workouts: workoutsRouter,
  templates: templatesRouter,
  analytics: analyticsRouter,
  admin: adminRouter,
});
export type AppRouter = typeof appRouter;
