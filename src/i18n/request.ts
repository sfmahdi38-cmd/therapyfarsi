import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { resolveLocale } from './locale';

export default getRequestConfig(async () => {
  const locale = resolveLocale((await cookies()).get('NEXT_LOCALE')?.value);
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
