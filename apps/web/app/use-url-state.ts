"use client";
import {useEffect,useState,useCallback} from 'react';
/** Keep navigation in the URL so reload, links, back and forward preserve it. */
export function useUrlState(key:string,fallback:string,allowed?:readonly string[]){
 const [value,setValue]=useState(fallback);
 useEffect(()=>{const read=()=>{const params=new URLSearchParams(location.search);let next=params.get(key)||fallback;if(key==='tab'&&params.has('conversation'))next='Inbox';else if(key==='tab'&&params.has('attention'))next='Attention';else if(key==='view'&&next==='assistant')next='Assistant controls';setValue(!allowed||allowed.includes(next)?next:fallback)};read();window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read)},[key,fallback]);
 const update=useCallback((next:string)=>{const url=new URL(location.href);url.searchParams.set(key,next);if(key==='tab'){url.searchParams.delete('conversation');url.searchParams.delete('attention')}window.history.pushState(null,'',url);setValue(next)},[key]);
 return [value,update] as const;
}
