import type {MetadataRoute} from 'next';
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:['/','/privacy','/terms','/data-deletion','/support'],disallow:['/admin','/status','/calendar','/status-api','/organizations']},sitemap:(process.env.NEXT_PUBLIC_SITE_URL||'https://codetic.netawaz.pk')+'/sitemap.xml'};}
