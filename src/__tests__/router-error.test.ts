import { describe, expect, it } from "vitest";
import { isStaleBundleError } from "@/router";

describe("isStaleBundleError", () => {
  it("reconhece falha de import dinâmico após deploy", () => {
    expect(
      isStaleBundleError(
        new TypeError("Failed to fetch dynamically imported module: /assets/x.js"),
      ),
    ).toBe(true);
    expect(isStaleBundleError(new Error("Importing a module script failed."))).toBe(true);
  });
  it("não confunde erro comum de render", () => {
    expect(isStaleBundleError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });
});
