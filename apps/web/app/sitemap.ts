import type {MetadataRoute} from 'next';
export default function sitemap():MetadataRoute.Sitemap{const base=process.env.NEXT_PUBLIC_SITE_URL||'https://codetic.netawaz.pk';return ['','/privacy','/terms','/data-deletion','/support'].map(path=>({url:base+path,changeFrequency:'monthly',priority:path?0.5:1}));}
