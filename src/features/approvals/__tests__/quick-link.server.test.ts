import { describe, expect, it } from "vitest";
import { hashQuickToken, QUICK_LINK_TTL_HOURS } from "../quick-link.server";

describe("hashQuickToken", () => {
  it("é determinístico e devolve SHA-256 em hex (64 chars)", () => {
    const hash = hashQuickToken("token-de-teste");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashQuickToken("token-de-teste")).toBe(hash);
  });

  it("tokens diferentes geram hashes diferentes e o token em claro não aparece no hash", () => {
    expect(hashQuickToken("a")).not.toBe(hashQuickToken("b"));
    expect(hashQuickToken("segredo")).not.toContain("segredo");
  });

  it("a validade do link é de 4 horas (decisão do Gelson, 30/09/2026)", () => {
    expect(QUICK_LINK_TTL_HOURS).toBe(4);
  });
});
