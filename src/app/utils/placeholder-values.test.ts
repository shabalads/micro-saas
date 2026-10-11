import { describe, expect, it } from "vitest";
import { PLACEHOLDER_PHRASES, isPlaceholderValue, normalizeForPlaceholder } from "./placeholder-values";

describe("placeholder values (a cell that says there is nothing)", () => {
  it.each([
    // generic
    "n/a", "N/A", "  null ", "NULL", "none", "nil", "undefined", "TBD", "-", "--", "---", "....", "_____", "—", "#N/A", "#NULL!", "?",
    // English
    "no description", "No description available", "Description not available", "not available", "No data",
    // Czech and Slovak
    "popis není k dispozici", "POPIS NENÍ K DISPOZICI", "Popis neni k dispozici", "bez popisu", "Žádný popis", "popis nie je k dispozícii", "nevyplněno",
    // Polish
    "brak opisu", "BRAK OPISU", "Brak danych", "nie dotyczy",
    // German, French, Spanish, Italian
    "keine Beschreibung", "Beschreibung nicht verfügbar", "pas de description", "Description non disponible", "sin descripción", "Sin descripcion", "nessuna descrizione",
    // other languages
    "nincs leírás", "geen beschrijving", "sem descrição", "нет описания",
    // markup, quotes and entities around a placeholder do not hide it
    "<p>N/A</p>", "<span>popis není k dispozici</span>", "&nbsp;n/a&nbsp;", '"-"', "(none)", "<div><div>brak opisu</div></div>",
  ])("%j is a placeholder", (value) => {
    expect(isPlaceholderValue(value)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "<p>&nbsp;</p>", // empty markup is empty, not a placeholder
    "<br>",
    "A durable steel bottle.",
    "Odolný materiál, snadná údržba.",
    "No description needed: it speaks for itself",
    "Not available in red",
    "none of the above fit",
    "Sale",
    "N/A sizes only",
  ])("%j is not", (value) => {
    expect(isPlaceholderValue(value)).toBe(false);
  });

  it("compares without caring about case or accents", () => {
    expect(normalizeForPlaceholder("  POPIS NENÍ K DISPOZICI! ")).toBe("popis neni k dispozici");
    expect(PLACEHOLDER_PHRASES.has("popis neni k dispozici")).toBe(true);
    expect(PLACEHOLDER_PHRASES.has("brak opisu")).toBe(true);
  });

  it("covers the languages the data file claims to", () => {
    for (const phrase of ["popis není k dispozici", "popis nie je k dispozícii", "brak opisu", "keine beschreibung", "pas de description", "sin descripción", "nessuna descrizione", "no description"]) {
      expect(PLACEHOLDER_PHRASES.has(normalizeForPlaceholder(phrase)), phrase).toBe(true);
    }
  });
});
