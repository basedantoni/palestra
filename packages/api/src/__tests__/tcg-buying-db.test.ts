/**
 * Buying flow against real SQL (KOI-311): the received Copy shows up in the
 * collection, owned markers, and below-minimum flags (subqueries and joins the
 * mock-db can't evaluate), and a bought Offer stays put until the order is cancelled.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { tcgPrinting, user } from "@life-tracker/db/schema/index";

import { upsertCatalog } from "../lib/tcg/catalog-db";
import { catalog } from "../lib/tcg/fixtures";
import { appRouter } from "../routers/index";
import { truncateAll } from "./helpers/pglite";

const ME = "user-tcg";
const caller = appRouter.createCaller({ session: { user: { id: ME } } } as any);
const VARIANT = "OP05-119_p1";

/** An open Want (min LP) with one $18.50 Offer for the English Printing. */
async function wantWithOffer() {
  const [printing] = await db
    .select({ id: tcgPrinting.id })
    .from(tcgPrinting)
    .where(and(eq(tcgPrinting.variantId, VARIANT), eq(tcgPrinting.language, "en")));
  const want = await caller.tcg.wants.create({ variantId: VARIANT, languages: ["en"], maxPrice: 20, minCondition: "LP" });
  const offer = await caller.tcg.offers.create({
    wantId: want.id,
    printingId: printing!.id,
    seller: "Local store",
    price: 18.5,
    seenOn: "2026-10-01",
  });
  return { wantId: want.id, offerId: offer.id, printingId: printing!.id };
}

beforeEach(async () => {
  await truncateAll(db);
  await upsertCatalog(catalog);
  await db.insert(user).values({ id: ME, name: "Me", email: "me@example.test" });
});

describe("buying flow (real SQL)", () => {
  it("bought → received puts a Copy in the collection, flagged when below the minimum", async () => {
    const { wantId, offerId, printingId } = await wantWithOffer();

    await caller.tcg.wants.buy({ id: wantId, offerId });
    expect(await caller.tcg.wants.list({ status: "ordered" })).toMatchObject([{ id: wantId, boughtOfferId: offerId }]);

    await caller.tcg.wants.receive({ id: wantId, condition: "MP", acquiredOn: "2026-10-11" });

    expect(await caller.tcg.wants.list({ status: "fulfilled" })).toMatchObject([
      { id: wantId, boughtOfferId: offerId, receivedCondition: "MP", belowMinimum: true },
    ]);
    expect(await caller.tcg.copies.list()).toMatchObject([
      { printingId, condition: "MP", pricePaid: 18.5, acquiredOn: "2026-10-11", belowMinimum: true },
    ]);
    const browse = await caller.tcg.artworks({ owned: true });
    expect(browse.map((a) => a.variantId)).toEqual([VARIANT]);
  });

  it("keeps the bought Offer until the order is cancelled", async () => {
    const { wantId, offerId } = await wantWithOffer();
    await caller.tcg.wants.buy({ id: wantId, offerId });

    await expect(caller.tcg.offers.delete({ id: offerId })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.tcg.wants.cancelOrder({ id: wantId });
    expect(await caller.tcg.wants.list()).toMatchObject([{ id: wantId, status: "open", boughtOfferId: null }]);
    await caller.tcg.offers.delete({ id: offerId });
  });
});
