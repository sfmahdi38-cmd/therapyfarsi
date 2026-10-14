export const locales = ['fa', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'fa';

export function resolveLocale(value: string | undefined): Locale {
  return (locales as readonly string[]).includes(value ?? '') ? (value as Locale) : defaultLocale;
}

export const dirOf = (locale: Locale): 'rtl' | 'ltr' => (locale === 'fa' ? 'rtl' : 'ltr');
