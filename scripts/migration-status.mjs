import 'dotenv/config';
import pg from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {pendingMigrations} from './migration-policy.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL_CA_FILE?{ca:readFileSync(process.env.DATABASE_SSL_CA_FILE,'utf8'),rejectUnauthorized:true}:undefined});
try{
 await client.connect();
 if(!(await client.query("select to_regclass('codetic_ops.migrations') as name")).rows[0].name)throw Error('A reviewed migration baseline is required before automatic deployment');
 const applied=new Map((await client.query('select filename,checksum from codetic_ops.migrations')).rows.map(r=>[r.filename,r.checksum]));
 const policy=JSON.parse(readFileSync('deploy/migration-policy.json','utf8'));
 const files=new Map(readdirSync('supabase/migrations').filter(f=>/^\d{12,}_.*\.sql$/.test(f)).map(file=>[file,readFileSync('supabase/migrations/'+file,'utf8')]));
 console.log(JSON.stringify(pendingMigrations(files,applied,policy)));
}catch(error){console.error('Migration preflight failed:',error.code||error.message);process.exitCode=1;}
finally{await client.end().catch(()=>{});}
