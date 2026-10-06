import { afterEach, describe, expect, it, vi } from "vitest";
import { getOmieEnv } from "../env";

describe("getOmieEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("devolve as credenciais quando as variáveis existem", () => {
    vi.stubEnv("OMIE_APP_KEY", "k");
    vi.stubEnv("OMIE_APP_SECRET", "s");
    expect(getOmieEnv()).toEqual({ appKey: "k", appSecret: "s" });
  });

  it("falha com erro claro (sem valor padrão no código) quando falta a chave", () => {
    vi.stubEnv("OMIE_APP_KEY", "");
    vi.stubEnv("OMIE_APP_SECRET", "s");
    expect(() => getOmieEnv()).toThrow("OMIE_APP_KEY");
  });

  it("falha com erro claro quando falta o segredo", () => {
    vi.stubEnv("OMIE_APP_KEY", "k");
    vi.stubEnv("OMIE_APP_SECRET", "");
    expect(() => getOmieEnv()).toThrow("OMIE_APP_SECRET");
  });
});
