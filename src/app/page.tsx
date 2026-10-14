import { getTranslations } from 'next-intl/server';

export default async function HomePage() {
  const t = await getTranslations('home');
  return (
    <main className="page">
      <h1 className="brand">{t('brand')}</h1>
      <p className="muted">{t('soon')}</p>
    </main>
  );
}
