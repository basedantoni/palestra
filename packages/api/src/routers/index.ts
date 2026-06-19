import { protectedProcedure, publicProcedure, router } from "../index";
import { analyticsRouter } from "./analytics";
import { adminRouter } from "./admin";
import { dataExportRouter } from "./data-export";
import { exercisesRouter } from "./exercises";
import { importRouter } from "./import";
import { notificationsRouter } from "./notifications";
import { plaidRouter } from "./plaid";
import { preferencesRouter } from "./preferences";
import { templatesRouter } from "./templates";
import { tcxImportRouter } from "./tcx-import";
import { whoopRouter } from "./whoop";
import { whoopRecoveryRouter } from "./whoop-recovery";
import { whoopSleepRouter } from "./whoop-sleep";
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
  tcxImport: tcxImportRouter,
  whoop: whoopRouter,
  whoopSleep: whoopSleepRouter,
  whoopRecovery: whoopRecoveryRouter,
  plaid: plaidRouter,
});
export type AppRouter = typeof appRouter;
