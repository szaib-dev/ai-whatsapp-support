import {createHash} from 'node:crypto';
const checksum=sql=>createHash('sha256').update(sql).digest('hex');
// Pure preflight shared with regression tests. Never changes the ledger or schema.
export function pendingMigrations(files,applied,policy){
 for(const file of applied.keys())if(!files.has(file))throw Error('Applied migration missing from release: '+file);
 const pending=[];
 for(const [file,sql] of [...files.entries()].sort(([a],[b])=>a.localeCompare(b))){
  const normalized=sql.replace(/\r\n/g,'\n');
  const canonical=checksum(normalized);
  if(applied.has(file)){
   // Match migrate.mjs legacy checksum adoption, without mutating during preflight.
   const allowed=[canonical,checksum(normalized.replace(/\n/g,'\r\n')),checksum(sql)];
   if(!allowed.includes(applied.get(file)))throw Error('Applied migration content changed: '+file);
   continue;
  }
  if(policy[file]?.sha256!==canonical||policy[file]?.backwardCompatible!==true)throw Error('Pending migration needs a reviewed backward-compatible policy entry: '+file);
  pending.push(file);
 }
 return {pending,rollbackSafe:true};
}
