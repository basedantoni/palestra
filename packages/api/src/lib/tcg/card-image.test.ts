import { describe, expect, it } from "vitest";

import { bandaiCardImageUrl } from "./card-image";

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
