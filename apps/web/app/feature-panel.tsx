"use client";
import {useEffect,useState} from 'react';
import type {Request} from './knowledge-editor';
import {Icon} from './icons';
export default function FeaturePanel({org,request}:{org:string;request:Request}){
 const [enabled,setEnabled]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;void request(`/organizations/${org}/features`).then(v=>{if(active)setEnabled(v.advancedAppointments)}).catch(e=>{if(active)setNotice(e.message)});return()=>{active=false}},[org,request]);
 return <section className="panel"><div className="panel-heading"><span className="eyebrow">WORKSPACE FEATURES</span><h2>Give this business more control</h2><p>Permissions apply to this business only. No payment or subscription is required.</p></div><label className="toggle-row"><span><strong><Icon name="calendar" size={18}/> Advanced appointment management <span className="badge premium">Premium</span></strong><p>Create, edit, reschedule and cancel bookings from the client portal, with calendar views and blocked time.</p></span><input type="checkbox" role="switch" checked={!!enabled} disabled={enabled===null||busy} onChange={async e=>{const next=e.target.checked;setBusy(true);setNotice('');try{await request(`/organizations/${org}/features/advanced_appointments`,{enabled:next},'PATCH');setEnabled(next);setNotice(next?'Appointment management enabled for this business.':'Appointment management locked. Basic appointment viewing remains available.')}catch(e){setNotice((e as Error).message)}finally{setBusy(false)}}}/></label>{enabled===null&&!notice&&<div className="skeleton" role="status" aria-label="Loading feature permissions"/>}{notice&&<p role="status" className="form-notice">{notice}</p>}</section>;
}
