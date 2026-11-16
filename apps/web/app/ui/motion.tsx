"use client";
import {animate,MotionConfig,motion,useReducedMotion} from 'motion/react';
import {useEffect,useRef,type ReactNode} from 'react';
import {toast} from 'sonner';

export const motionTiming={micro:.18,component:.28,section:.5};
export const motionEase=[.22,1,.36,1] as const;

export function MotionSystem({children}:{children:ReactNode}){
 return <MotionConfig reducedMotion="user" transition={{duration:motionTiming.component,ease:motionEase}}>{children}</MotionConfig>;
}
/** Enter the new state immediately. No exit delay retains old workspace data. */
export function MotionView({children,motionKey,className}:{children:ReactNode;motionKey:string;className?:string}){
 const reduced=useReducedMotion();
 return <motion.div key={motionKey} data-motion-view="" className={className} initial={reduced?false:{opacity:0,y:7}} animate={{opacity:1,y:0}} transition={{duration:.28,ease:motionEase}}>{children}</motion.div>;
}

export function Reveal({children,className,delay=0}:{children:ReactNode;className?:string;delay?:number}){
 const ref=useRef<HTMLDivElement>(null),reduced=useReducedMotion();
 useEffect(()=>{
  const el=ref.current;if(!el||reduced)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){animate(el,{opacity:[0,1],y:[18,0]},{duration:.5,delay,ease:motionEase});observer.disconnect()}},{threshold:.08});
  observer.observe(el);return()=>observer.disconnect();
 },[delay,reduced]);
 return <div ref={ref} className={className}>{children}</div>;
}

export function AnimatedNumber({value}:{value:number}){
 const ref=useRef<HTMLSpanElement>(null),previous=useRef(value),reduced=useReducedMotion();
 useEffect(()=>{const el=ref.current;if(!el)return;const from=previous.current;if(reduced||from===value){previous.current=value;el.textContent=value.toLocaleString('en-GB');return}const control=animate(from,value,{duration:.4,ease:motionEase,onUpdate:n=>{previous.current=n;el.textContent=Math.round(n).toLocaleString('en-GB')}});return()=>control.stop()},[value,reduced]);
 return <span ref={ref} aria-label={value.toLocaleString('en-GB')}>{value.toLocaleString('en-GB')}</span>;
}

export function MotionNotice({message,onDismiss}:{message:string;onDismiss?:()=>void}){
 useEffect(()=>{if(message){toast(message,{id:'workspace-feedback',onDismiss});}},[message]);return null;
}
