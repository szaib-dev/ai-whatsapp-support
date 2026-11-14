import type {PoolClient} from 'pg';
import {pool} from './db.js';
export class WorkspaceChanges {
 private client?:PoolClient;
 private starting?:Promise<void>;
 private listeners=new Set<(org:string)=>void>();
 async subscribe(fn:(org:string)=>void){
  this.listeners.add(fn);
  if(!this.client){this.starting??=this.start().finally(()=>{this.starting=undefined});try{await this.starting}catch(e){this.listeners.delete(fn);throw e}}
  return ()=>this.listeners.delete(fn);
 }
 private async start(){const client=await pool.connect();try{await client.query('LISTEN workspace_changes');this.client=client;client.on('notification',msg=>{if(msg.payload)for(const fn of this.listeners)fn(msg.payload)});client.on('error',()=>{if(this.client===client){this.client=undefined;client.release(true);for(const fn of this.listeners)fn('*')}})}catch(e){client.release(true);throw e}}
 async close(){this.listeners.clear();if(this.client){const c=this.client;this.client=undefined;await c.query('UNLISTEN workspace_changes').catch(()=>{});c.release(true)}}
}
