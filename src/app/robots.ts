import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/call-test', '/api/'] },
    sitemap: 'https://therapyfarsi.com/sitemap.xml',
  };
}
