import { describe, expect, it } from "vitest";
import { parseBRLNumber } from "@/lib/number";

describe("parseBRLNumber", () => {
  it("converte decimal pt-BR simples", () => {
    expect(parseBRLNumber("1234,56")).toBe(1234.56);
    expect(parseBRLNumber("0,5")).toBe(0.5);
  });

  it("remove separador de milhar antes da vírgula decimal (bug original: virava NaN)", () => {
    expect(parseBRLNumber("1.234,56")).toBe(1234.56);
    expect(parseBRLNumber("1.234.567,89")).toBe(1234567.89);
  });

  it("aceita formato en-US já com ponto decimal", () => {
    expect(parseBRLNumber("1234.56")).toBe(1234.56);
    expect(parseBRLNumber("12.3")).toBe(12.3);
  });

  it("trata ponto seguido de 3 dígitos sem vírgula como milhar", () => {
    expect(parseBRLNumber("1.234")).toBe(1234);
    expect(parseBRLNumber("12.345")).toBe(12345);
    expect(parseBRLNumber("1.234.567")).toBe(1234567);
  });

  it("ignora símbolo de moeda e espaços", () => {
    expect(parseBRLNumber("R$ 1.234,56")).toBe(1234.56);
    expect(parseBRLNumber("r$1234,56")).toBe(1234.56);
    expect(parseBRLNumber(" 1 234,56 ")).toBe(1234.56);
  });

  it("inteiros passam direto", () => {
    expect(parseBRLNumber("1234")).toBe(1234);
    expect(parseBRLNumber("7")).toBe(7);
  });

  it("vazio/inválido/nulo retorna null", () => {
    expect(parseBRLNumber("")).toBeNull();
    expect(parseBRLNumber("   ")).toBeNull();
    expect(parseBRLNumber("abc")).toBeNull();
    expect(parseBRLNumber(null)).toBeNull();
    expect(parseBRLNumber(undefined)).toBeNull();
  });
});
