import { describe, expect, it } from "vitest";

import { baseNumber, judgeChoice, NONE, TYPESAFE_GATE, typesafeChooser } from "./typesafe-tier";

const candidates = [
  { variantId: "OP05-119_p1", variantKind: "parallel" as const, sets: ["OP-05"], rarity: "SecretRare", artist: null },
  { variantId: "OP05-119_p2", variantKind: "manga" as const, sets: ["OP-05"], rarity: "SecretRare", artist: null },
];

describe("judgeChoice", () => {
  it("accepts a candidate chosen at or above the gate, with its confidence", () => {
    expect(judgeChoice({ choice: "OP05-119_p2", confidence: 0.97 }, candidates, 0.9)).toEqual({
      variantId: "OP05-119_p2",
      confidence: 0.97,
    });
    expect(judgeChoice({ choice: "OP05-119_p1", confidence: 0.9 }, candidates, 0.9)).toMatchObject({
      variantId: "OP05-119_p1",
    });
  });

  it("rejects a choice below the gate, naming the tier, the choice and the gate", () => {
    expect(judgeChoice({ choice: "OP05-119_p2", confidence: 0.42 }, candidates, 0.9)).toEqual({
      reason: "TypeSafe tier: OP05-119_p2 at confidence 0.42, below the 0.9 gate",
    });
  });

  it("rejects 'none' at any confidence", () => {
    expect(judgeChoice({ choice: NONE, confidence: 1 }, candidates, 0.9)).toEqual({
      reason: "TypeSafe tier: none of the 2 candidate Artworks fits",
    });
  });

  it("rejects an answer that is not one of the candidates", () => {
    expect(judgeChoice({ choice: "OP05-119_p9", confidence: 1 }, candidates, 0.9)).toEqual({
      reason: "TypeSafe tier: answered OP05-119_p9, not a candidate",
    });
  });

  it("gates on the repo's tuned value by default", () => {
    expect(judgeChoice({ choice: "OP05-119_p1", confidence: TYPESAFE_GATE - 0.01 }, candidates)).toHaveProperty("reason");
    expect(judgeChoice({ choice: "OP05-119_p1", confidence: TYPESAFE_GATE }, candidates)).toMatchObject({ variantId: "OP05-119_p1" });
  });
});

describe("baseNumber", () => {
  it("drops CardTrader's variant letter from a collector number", () => {
    expect(baseNumber("OP05-119a")).toBe("OP05-119");
    expect(baseNumber("OP05-002b")).toBe("OP05-002");
    expect(baseNumber("OP05-119")).toBe("OP05-119");
    expect(baseNumber("P-001")).toBe("P-001");
  });
});

/** fetch answering like the TypeSafe API, keeping each request it was sent. */
function fakeTypesafe(answer: unknown, status = 200) {
  const requests: Array<{ url: string; headers: Headers; body: any }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(answer), { status });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

describe("typesafeChooser", () => {
  const product = {
    marketplace: "cardtrader" as const,
    name: "Monkey.D.Luffy",
    number: "OP05-119a",
    set: "op05",
    rarity: "Secret Rare",
    tags: ["Manga"],
  };

  it("asks one Choice among the candidates and 'none', with the product as state", async () => {
    const { fetch, requests } = fakeTypesafe({
      model: "jev-1.14.0",
      answers: { artwork: { type: "choice", choice: "OP05-119_p2", confidence: 0.93, probabilities: {} } },
      usage: { input_tokens: 300, output_tokens: 0 },
    });
    const answer = await typesafeChooser("ts-key", fetch)(product, candidates);

    expect(answer).toEqual({ choice: "OP05-119_p2", confidence: 0.93 });
    expect(requests).toHaveLength(1);
    const { url, headers, body } = requests[0]!;
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(headers.get("authorization")).toBe("Bearer ts-key");
    expect(body.model).toBe("jev-1.14.0");
    expect(body.state.product).toMatchObject({ name: "Monkey.D.Luffy", number: "OP05-119a", version: "Manga" });
    expect(Object.keys(body.questions.artwork.criteria)).toEqual(["OP05-119_p1", "OP05-119_p2", NONE]);
    expect(body.questions.artwork.criteria["OP05-119_p2"]).toMatchObject({ kind: "manga", sets: ["OP-05"] });
  });

  it("fails on an error response", async () => {
    const { fetch } = fakeTypesafe({ detail: "bad key" }, 401);
    await expect(typesafeChooser("ts-key", fetch)(product, candidates)).rejects.toThrow(/401/);
  });
});
