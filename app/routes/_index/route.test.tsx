import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("root landing page", () => {
  it("uses ReviewNest branding instead of the default Shopify starter content", () => {
    const source = readFileSync(new URL("./route.tsx", import.meta.url), "utf8");

    expect(source).toContain("ReviewNest");
    expect(source).not.toContain("[your app]");
  });
});
