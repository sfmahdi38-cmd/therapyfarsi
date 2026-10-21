import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import '@fontsource-variable/vazirmatn';
import './globals.css';
import { dirOf, resolveLocale } from '@/i18n/locale';

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations('meta'), getLocale()]);
  return {
    metadataBase: new URL('https://therapyfarsi.com'),
    title: t('title'),
    description: t('description'),
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      url: '/',
      siteName: 'TherapyFarsi',
      title: t('title'),
      description: t('description'),
      locale: resolveLocale(locale) === 'fa' ? 'fa_IR' : 'en_GB',
    },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = resolveLocale(await getLocale());
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
