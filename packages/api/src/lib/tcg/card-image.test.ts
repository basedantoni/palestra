import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bandaiCardImageUrl, relayCardImage } from "./card-image";

describe("bandaiCardImageUrl", () => {
  it("accepts Bandai card images in either language", () => {
    for (const src of [
      "https://www.onepiece-cardgame.com/images/cardlist/card/OP05-119_p2.png?260828",
      "https://en.onepiece-cardgame.com/images/cardlist/card/OP05-119_p2.png?260929",
    ]) {
      expect(bandaiCardImageUrl(src)?.href).toBe(src);
    }
  });

  it("rejects anything else, so the proxy can't fetch arbitrary URLs", () => {
    for (const src of [
      "http://www.onepiece-cardgame.com/images/cardlist/card/OP05-119.png",
      "https://evil.example/images/cardlist/card/OP05-119.png",
      "https://www.onepiece-cardgame.com.evil.example/images/cardlist/card/OP05-119.png",
      "https://www.onepiece-cardgame.com/cardlist/",
      "https://www.onepiece-cardgame.com/images/cardlist/card/../../secret",
      "https://user@www.onepiece-cardgame.com/images/cardlist/card/OP05-119.png",
      "not a url",
    ]) {
      expect(bandaiCardImageUrl(src)).toBeNull();
    }
  });
});

describe("relayCardImage", () => {
  // A stand-in upstream: the relay is handed an already-allowlisted URL, so a local server exercises real fetch.
  const hits: string[] = [];
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url!);
      if (req.url === "/card.png") res.writeHead(200, { "Content-Type": "image/png" }).end("png-bytes");
      else if (req.url === "/redirect.png") res.writeHead(302, { Location: "/elsewhere" }).end();
      else if (req.url === "/missing.png") res.writeHead(404).end();
      // /slow.png never answers.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("relays the image with a long private cache", async () => {
    const res = await relayCardImage(new URL(`${base}/card.png`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=604800");
    expect(await res.text()).toBe("png-bytes");
  });

  it("refuses to follow a redirect, which could lead off the allowlist", async () => {
    const res = await relayCardImage(new URL(`${base}/redirect.png`));
    expect(res.status).toBe(502);
    expect(hits).not.toContain("/elsewhere");
  });

  it("gives up on an upstream that doesn't answer in time", async () => {
    const res = await relayCardImage(new URL(`${base}/slow.png`), 50);
    expect(res.status).toBe(504);
  });

  it("reports a failed upstream as unavailable", async () => {
    expect((await relayCardImage(new URL(`${base}/missing.png`))).status).toBe(502);
  });
});
