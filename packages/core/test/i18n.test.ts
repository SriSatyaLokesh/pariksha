import { describe, expect, it } from "vitest";
import {
  createTranslator,
  isRtlLocale,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type LocaleCode,
} from "../src/i18n/index.js";

describe("Core i18n & Translation System (T-24)", () => {
  it("exports supported locales and default locale", () => {
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("hi");
    expect(SUPPORTED_LOCALES).toContain("es");
    expect(SUPPORTED_LOCALES).toContain("ar");
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("detects RTL direction for Arabic and LTR for others", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(isRtlLocale("en")).toBe(false);
    expect(isRtlLocale("hi")).toBe(false);
    expect(isRtlLocale("es")).toBe(false);
    expect(isRtlLocale("fr")).toBe(false); // unknown locale defaults to false
  });

  it("translates standard English strings", () => {
    const t = createTranslator("en");
    expect(t("exam.start")).toBe("Start assessment");
    expect(t("exam.next")).toBe("Next");
    expect(t("exam.prev")).toBe("Previous");
    expect(t("exam.submit")).toBe("Submit exam");
  });

  it("interpolates parameters in translation strings", () => {
    const t = createTranslator("en");
    expect(t("exam.question_counter", { current: 3, total: 20 })).toBe(
      "Question 3 of 20",
    );
    expect(t("exam.time_remaining", { time: "14:50" })).toBe(
      "Time remaining: 14:50",
    );
  });

  it("translates into Hindi, Spanish, and Arabic", () => {
    const tHi = createTranslator("hi");
    expect(tHi("exam.start")).toMatch(/शुरू/);
    expect(tHi("exam.next")).toMatch(/आगे|अगला/);

    const tEs = createTranslator("es");
    expect(tEs("exam.start")).toMatch(/Iniciar/i);
    expect(tEs("exam.next")).toMatch(/Siguiente/i);

    const tAr = createTranslator("ar");
    expect(tAr("exam.start")).toMatch(/بدء/);
    expect(tAr("exam.next")).toMatch(/التالي/);
  });

  it("falls back to English when locale or key is unknown", () => {
    // Unknown locale falls back to English dictionary
    const tUnknown = createTranslator("de" as LocaleCode);
    expect(tUnknown("exam.start")).toBe("Start assessment");

    // English lookup
    const t = createTranslator("hi");
    expect(t("exam.unsupported_key" as any)).toBe("exam.unsupported_key");
  });
});
