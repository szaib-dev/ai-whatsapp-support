import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {pendingMigrations} from '../scripts/migration-policy.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const file='202611160001_example.sql',sql='select 1;\n';
const files=new Map([[file,sql]]);
const policy={[file]:{sha256:hash(sql),backwardCompatible:true}};
describe('automatic deployment migration guard',()=>{
 it('requires an exact reviewed compatible checksum for new SQL',()=>{
  expect(pendingMigrations(files,new Map(),policy).pending).toEqual([file]);
  for(const invalid of [{},{[file]:{...policy[file],backwardCompatible:false}},{[file]:{...policy[file],sha256:'wrong'}}])expect(()=>pendingMigrations(files,new Map(),invalid)).toThrow('reviewed backward-compatible');
 });
 it('accepts legacy CRLF checksums but refuses edited applied migrations',()=>{
  expect(pendingMigrations(files,new Map([[file,hash(sql.replace(/\n/g,'\r\n'))]]),{}).pending).toEqual([]);
  expect(()=>pendingMigrations(files,new Map([[file,hash('select 2;')]]),policy)).toThrow('content changed');
 });
 it('refuses releases that removed applied migration files',()=>{
  expect(()=>pendingMigrations(new Map(),new Map([[file,hash(sql)]]),{})).toThrow('missing from release');
 });
 it('has reviewed policy entries matching the checked-in SQL',()=>{
  const actual=new Map(readdirSync('supabase/migrations').filter(f=>/^\d{12,}_.*\.sql$/.test(f)).map(f=>[f,readFileSync('supabase/migrations/'+f,'utf8')]));
  expect(pendingMigrations(actual,new Map(),JSON.parse(readFileSync('deploy/migration-policy.json','utf8'))).pending).toHaveLength(actual.size);
 });
});
