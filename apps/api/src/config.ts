import {existsSync} from 'node:fs';
export function configurationIssues(env:NodeJS.ProcessEnv=process.env){
 const errors:string[]=[];const production=env.NODE_ENV==='production';
 for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_ANON_KEY'])if(!env[key]?.trim())errors.push(`${key} is required`);
 if(env.SESSION_ENCRYPTION_KEY&&Buffer.from(env.SESSION_ENCRYPTION_KEY,'base64').length!==32)errors.push('SESSION_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
 for(const key of ['SUPABASE_ANON_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']){const value=env[key]||'';let role='';try{role=JSON.parse(Buffer.from(value.split('.')[1]||'','base64url').toString()).role}catch{}if(value.startsWith('sb_secret_')||role==='service_role')errors.push(`${key} must be a public anon/publishable key, never a service-role key`);}
 if(production){
  for(const key of ['SESSION_ENCRYPTION_KEY','DEEPSEEK_API_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','OPERATOR_LEGAL_NAME','OPERATOR_COUNTRY','SUPPORT_EMAIL','PRIVACY_EMAIL','BACKUP_RETENTION_DESCRIPTION','DATABASE_URL','SUPABASE_URL','SUPABASE_ANON_KEY'])if(!env[key]?.trim()||/(?:^|[\/:@])(?:SET_|CHANGE_|REPLACE_)/i.test(env[key]||''))errors.push(`${key} must be configured for production`);
  for(const key of ['WEB_ORIGIN','PUBLIC_API_URL']){try{const url=new URL(env[key]||'');if(url.protocol!=='https:'||url.origin!==env[key]||url.username||url.password||['localhost','127.0.0.1'].includes(url.hostname))throw Error()}catch{errors.push(`${key} must be a public HTTPS origin with no path or trailing slash`);}}
  for(const key of ['SUPPORT_EMAIL','PRIVACY_EMAIL'])if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env[key]||''))errors.push(`${key} must be a valid contact email`);
  if(env.CALENDAR_ALLOW_LOCAL_OAUTH==='true')errors.push('CALENDAR_ALLOW_LOCAL_OAUTH must be false in production');
  if(!env.DATABASE_SSL_CA_FILE||!existsSync(env.DATABASE_SSL_CA_FILE))errors.push('DATABASE_SSL_CA_FILE must point to an existing trusted database CA');
  try{const db=new URL(env.DATABASE_URL||'');if(db.port==='6543')errors.push('Use a direct or session-mode PostgreSQL connection, not transaction pooler port 6543');for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])if(db.searchParams.has(key))errors.push('Remove connection-URL SSL overrides; use DATABASE_SSL_CA_FILE for verified TLS');}catch{errors.push('DATABASE_URL must be a valid PostgreSQL URL');}
  if(env.LEGAL_DISCLOSURES_APPROVED!=='true')errors.push('LEGAL_DISCLOSURES_APPROVED requires operator review of privacy, terms, retention and deletion practices');
  if(env.AI_PROVIDER_DATA_TERMS_CONFIRMED!=='true')errors.push('AI_PROVIDER_DATA_TERMS_CONFIRMED requires review of provider retention, processing and Google Limited Use restrictions');
 }
 return errors;
}
export function validateEnvironment(){const issues=configurationIssues();if(issues.length)throw Error('Configuration errors: '+issues.join('; '));}
