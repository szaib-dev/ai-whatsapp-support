"use client";
import AuthScreen from '../../auth-screen';
import {useEffect,useState} from 'react';import {getBrowserAuth} from '../../auth-client';
export default function AdminLogin(){const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);const [auth,setAuth]=useState<ReturnType<typeof getBrowserAuth>>(null),[ready,setReady]=useState(false);useEffect(()=>{setAuth(getBrowserAuth());setReady(true)},[]);
 async function enter(token:string){const r=await fetch('/admin/auth/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:token})});if(!r.ok)throw Error('Administrator access could not be verified. Check your workspace membership or contact the operator.');const destination=new URLSearchParams(window.location.search).get('next');window.location.assign(destination?.startsWith('/admin?')?destination:'/admin');}
 useEffect(()=>{let active=true;void auth?.auth.getSession().then(async({data})=>{if(active&&data.session)try{await enter(data.session.access_token)}catch{if(active)setNotice('Please sign in with an authorized administrator account.')}});return()=>{active=false}},[auth]);
 return <AuthScreen kind="admin" email={email} password={password} onEmail={setEmail} onPassword={setPassword} onSubmit={()=>void signIn()} busy={busy} error={notice} ready={ready&&!!auth}/>;
 async function signIn(){if(busy||!auth)return;setBusy(true);setNotice('');try{const {data,error}=await auth.auth.signInWithPassword({email,password});if(error||!data.session)throw Error('Sign-in failed. Check your email and password.');setPassword('');await enter(data.session.access_token)}catch(error){setNotice((error as Error).message)}finally{setBusy(false)}}
}
