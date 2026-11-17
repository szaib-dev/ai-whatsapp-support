/** Private, bounded memory cache. No customer data is persisted to browser storage. */
export class RequestCache {
 private entries=new Map<string,{value?:unknown;at:number;pending?:Promise<any>}>();
 clear(){this.entries.clear()}
 async read<T>(key:string,load:()=>Promise<T>,ttl=10000):Promise<T>{
  const old=this.entries.get(key);
  if(old?.pending)return old.pending;
  if(old&&Date.now()-old.at<ttl)return old.value as T;
  const entry:{value?:unknown;at:number;pending?:Promise<T>}={at:0};
  entry.pending=load().then(value=>{if(this.entries.get(key)===entry){entry.value=value;entry.at=Date.now();entry.pending=undefined}return value},error=>{if(this.entries.get(key)===entry)this.entries.delete(key);throw error});
  if(this.entries.size>=150)this.entries.delete(this.entries.keys().next().value!);
  this.entries.set(key,entry);return entry.pending;
 }
}
