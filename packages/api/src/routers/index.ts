import { protectedProcedure, publicProcedure, router } from "../index";
import { analyticsRouter } from "./analytics";
import { adminRouter } from "./admin";
import { dataExportRouter } from "./data-export";
import { exercisesRouter } from "./exercises";
import { importRouter } from "./import";
import { notificationsRouter } from "./notifications";
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
  notifications: notificationsRouter,
  workouts: workoutsRouter,
  templates: templatesRouter,
  analytics: analyticsRouter,
  dataExport: dataExportRouter,
  admin: adminRouter,
  import: importRouter,
});
export type AppRouter = typeof appRouter;
