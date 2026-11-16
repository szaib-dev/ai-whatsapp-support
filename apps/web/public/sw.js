/* No fetch handler: authenticated pages and customer data are never cached. */
const dbReady=new Promise((resolve,reject)=>{
 const request=indexedDB.open('codetic-push',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('seen',{keyPath:'id'});
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
async function firstDelivery(id){
 const db=await dbReady;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('seen','readwrite'),store=tx.objectStore('seen');let fresh=false;
  const request=store.get(id);
  request.onsuccess=()=>{if(!request.result){fresh=true;store.put({id,time:Date.now()});}};
  const cursor=store.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(row){if(row.value.time<Date.now()-7*86400000)row.delete();row.continue();}};
  tx.oncomplete=()=>resolve(fresh);tx.onerror=()=>reject(tx.error);
 });
}
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let data;try{data=event.data.json();}catch{return;}
  if(!data||typeof data.id!=='string'||typeof data.body!=='string')return;
  if(!await firstDelivery(data.id).catch(()=>true))return;
  await self.registration.showNotification(data.title||'Codetic AI',{
   body:data.body,icon:'/icon.svg',badge:'/icon.svg',tag:data.tag||'codetic-'+data.id,
   data:{url:data.url},actions:[{action:'open',title:'Open conversation'}]
  });
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const url=new URL(event.notification.data?.url||'/status',self.location.origin);
  if(url.origin!==self.location.origin||!['/admin','/status'].includes(url.pathname))return;
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  const current=windows.find(w=>new URL(w.url).pathname===url.pathname);
  if(current){await current.navigate(url.href);await current.focus();}else await clients.openWindow(url.href);
 })());
});
