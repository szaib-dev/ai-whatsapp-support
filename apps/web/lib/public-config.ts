export function publicConfig(){return {
 operator:process.env.OPERATOR_LEGAL_NAME||'Shahzaib Mirza (operating under the brand Codetic)',
 country:process.env.OPERATOR_COUNTRY||'Pakistan',
 support:process.env.SUPPORT_EMAIL||'szaib.dev@gmail.com',
 privacy:process.env.PRIVACY_EMAIL||'szaib.dev@gmail.com',
 site:process.env.NEXT_PUBLIC_SITE_URL||'https://codetic.netawaz.pk',
 backup:process.env.BACKUP_RETENTION_DESCRIPTION||'Backup retention depends on the configured database provider and operator backup schedule. Contact the operator for the applicable retention period.',
 approved:process.env.LEGAL_DISCLOSURES_APPROVED==='true'
};}
