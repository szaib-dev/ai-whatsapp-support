"use client";
import {useEffect,useState,type ReactNode} from 'react';
import {CalendarDays,Clock,ChevronDown} from 'lucide-react';
import {format,parseISO,isValid} from 'date-fns';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';
import {Accordion,AccordionItem,AccordionTrigger,AccordionContent} from '@/components/ui/accordion';
import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
import {Calendar} from '@/components/ui/calendar';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';

export function FormDialog({open=true,onClose,title,description,children,className='',busy=false}:{open?:boolean;onClose:()=>void;title:string;description?:string;children:ReactNode;className?:string;busy?:boolean}){
 return <Dialog open={open} onOpenChange={v=>{if(!v&&!busy)onClose()}}><DialogContent className={'product-dialog '+className} showCloseButton={!busy} onInteractOutside={e=>{if(busy)e.preventDefault()}}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description||'Review the details below.'}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
export function ConfirmDialog({open,title,description,children,busy=false,onCancel,onConfirm,confirmLabel='Confirm',destructive=false}:{open:boolean;title:string;description:string;children?:ReactNode;busy?:boolean;onCancel:()=>void;onConfirm:()=>void;confirmLabel?:string;destructive?:boolean}){
 return <AlertDialog open={open} onOpenChange={v=>{if(!v&&!busy)onCancel()}}><AlertDialogContent className="product-confirm"><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>{children}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button loading={busy} variant={destructive?'destructive':'default'} onClick={onConfirm}>{confirmLabel}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
export function Disclosure({title,children,defaultOpen=false}:{title:ReactNode;children:ReactNode;defaultOpen?:boolean}){return <Accordion type="single" collapsible defaultValue={defaultOpen?'content':undefined} className="product-disclosure"><AccordionItem value="content"><AccordionTrigger>{title}</AccordionTrigger><AccordionContent>{children}</AccordionContent></AccordionItem></Accordion>}
export function TimeSelect({value,onChange,label='Time',disabled=false}:{value:string;onChange:(v:string)=>void;label?:string;disabled?:boolean}){
 const [hour='09',minute='00']=value.split(':');const minutes=[...new Set([...Array.from({length:12},(_,i)=>String(i*5).padStart(2,'0')),minute])].sort();
 return <div className="time-select" aria-label={label}><Clock size={15}/><Select value={hour} onValueChange={h=>onChange(h+':'+minute)} disabled={disabled}><SelectTrigger aria-label={label+' hour'}><SelectValue/></SelectTrigger><SelectContent>{Array.from({length:24},(_,i)=>{const h=String(i).padStart(2,'0');return <SelectItem key={h} value={h}>{h}</SelectItem>})}</SelectContent></Select><span>:</span><Select value={minute} onValueChange={m=>onChange(hour+':'+m)} disabled={disabled}><SelectTrigger aria-label={label+' minutes'}><SelectValue/></SelectTrigger><SelectContent>{minutes.map(m=><SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>;
}
export function DateTimeField({value,onChange,label='Date and time'}:{value:string;onChange:(v:string)=>void;label?:string}){
 const [open,setOpen]=useState(false);const date=value?parseISO(value):undefined;const time=value.slice(11,16)||'09:00';
 return <div className="date-time-field"><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" className="date-trigger" aria-label={label+' date'}><CalendarDays size={17}/>{date&&isValid(date)?format(date,'EEE, dd MMM yyyy'):'Choose a date'}<ChevronDown size={14}/></Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={date&&isValid(date)?date:undefined} onSelect={d=>{if(d){onChange(format(d,'yyyy-MM-dd')+'T'+time);setOpen(false)}}}/></PopoverContent></Popover><TimeSelect label={label} value={time} onChange={t=>onChange((value.slice(0,10)||format(new Date(),'yyyy-MM-dd'))+'T'+t)}/></div>;
}
export function useUnsavedChanges(dirty:boolean){useEffect(()=>{if(!dirty)return;const before=(e:BeforeUnloadEvent)=>{e.preventDefault()};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before)},[dirty]);}
