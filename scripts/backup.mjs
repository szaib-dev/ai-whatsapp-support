import 'dotenv/config';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,rename,chmod} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
// Requires PostgreSQL client tools and age. The password is never placed in argv.
if(!process.env.DATABASE_URL||!process.env.DATABASE_SSL_CA_FILE||!process.env.BACKUP_AGE_RECIPIENT)throw Error('Set DATABASE_URL, DATABASE_SSL_CA_FILE and BACKUP_AGE_RECIPIENT');
const url=new URL(process.env.DATABASE_URL);
const directory=path.resolve(process.env.BACKUP_DIRECTORY||'backups');await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
const dest=path.join(directory,'codetic-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump.age');
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:'verify-full',PGSSLROOTCERT:process.env.DATABASE_SSL_CA_FILE};
const dump=spawn('pg_dump',['--format=custom','--no-owner','--schema=public','--schema=codetic_ops'],{env,stdio:['ignore','pipe','pipe']});
const encrypt=spawn('age',['-r',process.env.BACKUP_AGE_RECIPIENT],{stdio:['pipe','pipe','pipe']});
const done=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Backup subprocess failed; review tool availability and database permissions')));});
// Avoid echoing external tool errors that might include database connection details.
dump.stderr.resume();encrypt.stderr.resume();
try{await Promise.all([pipeline(dump.stdout,encrypt.stdin),pipeline(encrypt.stdout,createWriteStream(dest+'.partial',{mode:0o600,flags:'wx'})),done(dump),done(encrypt)]);await rename(dest+'.partial',dest);console.log('Encrypted application-schema backup created:',dest);}
catch{dump.kill();encrypt.kill();console.error('Backup failed. A partial encrypted file may remain; no successful backup was recorded.');process.exitCode=1;}
