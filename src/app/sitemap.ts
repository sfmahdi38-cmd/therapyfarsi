import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://therapyfarsi.com', changeFrequency: 'weekly', priority: 1 }];
}
