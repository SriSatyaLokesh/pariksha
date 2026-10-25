import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type LocaleCode,
  type TranslationDictionary,
  type TranslationKey,
  type Translator,
} from "./types.js";
import { en } from "./locales/en.js";
import { hi } from "./locales/hi.js";
import { es } from "./locales/es.js";
import { ar } from "./locales/ar.js";

export * from "./types.js";

const DICTIONARIES: Record<LocaleCode, TranslationDictionary> = {
  en,
  hi,
  es,
  ar,
};

/**
 * Checks if a given locale is Right-to-Left (e.g., Arabic).
 */
export function isRtlLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("ar");
}

/**
 * Creates a zero-dependency translator function for a given locale.
 * Falls back to English if key or locale is missing.
 */
export function createTranslator(locale?: string): Translator {
  const normLocale = (
    locale && SUPPORTED_LOCALES.includes(locale as LocaleCode)
      ? locale
      : DEFAULT_LOCALE
  ) as LocaleCode;

  const dict = DICTIONARIES[normLocale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const fallbackDict = DICTIONARIES[DEFAULT_LOCALE];

  return (key: TranslationKey, params?: Record<string, string | number>): string => {
    let template = dict[key] ?? fallbackDict[key] ?? String(key);
    if (!params) return template;

    for (const [k, v] of Object.entries(params)) {
      template = template.replaceAll(`{${k}}`, String(v));
    }
    return template;
  };
}
