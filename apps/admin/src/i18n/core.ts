import { en, type MessageKey } from './en';
import { fr } from './fr';

export type Locale = 'en' | 'fr';
export const LOCALES: readonly Locale[] = ['en', 'fr'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'amico_staff_lang';
export type { MessageKey };

export const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, fr };

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'fr';
}

export type Vars = Record<string, string | number>;
export type T = (key: MessageKey, vars?: Vars) => string;

/** Looks a key up and fills {placeholders}. Unknown placeholders are left visible so they get noticed. */
export function makeT(locale: Locale): T {
  const dict = DICTIONARIES[locale];
  return (key, vars) => {
    const raw = dict[key] ?? en[key] ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
  };
}

/** Picks the English or French field of an API record (titleEn / titleFr, name / nameFr). */
export function pick<T extends string | null | undefined>(locale: Locale, en: T, frValue: T): T {
  return locale === 'fr' && frValue ? frValue : en;
}
