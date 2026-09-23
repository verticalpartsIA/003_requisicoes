import { describe, expect, it } from "vitest";
import { csvField, csvRow } from "@/lib/csv";
import { decodeHtmlEntities, decodeHtmlEntitiesDeep } from "@/lib/html-entities";

describe("csvField/csvRow", () => {
  it("deixa campos simples como estão", () => {
    expect(csvRow(["M1-000152", "VPCON-975", 3])).toBe("M1-000152;VPCON-975;3");
  });

  it("protege campos com ; aspas ou quebra de linha", () => {
    expect(csvField('BROCA 1/4"')).toBe('"BROCA 1/4"""');
    expect(csvField("a;b")).toBe('"a;b"');
    expect(csvField("linha1\nlinha2")).toBe('"linha1\nlinha2"');
  });

  it("trata null/undefined como vazio", () => {
    expect(csvRow([null, undefined, "x"])).toBe(";;x");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodifica o que a Omie devolve", () => {
    expect(decodeHtmlEntities("SERRA COPO - 1/4&quot;")).toBe('SERRA COPO - 1/4"');
    expect(decodeHtmlEntities("A &amp; B &#39;x&#x27;")).toBe("A & B 'x'");
  });

  it("não decodifica duas vezes nem mexe em texto sem entidade", () => {
    expect(decodeHtmlEntities("&amp;quot;")).toBe("&quot;");
    expect(decodeHtmlEntities("P&D 100%")).toBe("P&D 100%");
    expect(decodeHtmlEntities("&foo;")).toBe("&foo;");
  });

  it("percorre objetos e arrays aninhados", () => {
    expect(
      decodeHtmlEntitiesDeep({ n: 1, lista: [{ descricao: "9.1/2&quot;" }], ok: true }),
    ).toEqual({ n: 1, lista: [{ descricao: '9.1/2"' }], ok: true });
  });
});
