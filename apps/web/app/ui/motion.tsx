"use client";
import {animate,AnimatePresence,MotionConfig,motion,useReducedMotion} from 'motion/react';
import {useEffect,useRef,type ReactNode} from 'react';
import {Icon} from '../icons';

export const motionTiming={micro:.18,component:.28,section:.5};
export const motionEase=[.22,1,.36,1] as const;

export function MotionSystem({children}:{children:ReactNode}){
 return <MotionConfig reducedMotion="user" transition={{duration:motionTiming.component,ease:motionEase}}>{children}<InterfaceMotion/></MotionConfig>;
}
function InterfaceMotion(){
 const reduced=useReducedMotion();
 useEffect(()=>{
  if(reduced)return;
  const seen=new WeakSet<Element>();
  const selector='.toast,.alert,.confirm-box,.panel,.metric-card,.appointment-row,.chat-panel';
  function enter(el:Element){
   if(seen.has(el)||el.hasAttribute('data-motion-notice')||!(el instanceof HTMLElement))return;
   seen.add(el);
   animate(el,{opacity:[0,1],y:[el.closest('[data-motion-view]')?0:el.matches('.toast,.alert')?5:7,0]},{duration:.25,ease:motionEase});
  }
  const observer=new MutationObserver(records=>{
   for(const record of records){
    if(record.type==='attributes'&&record.target instanceof HTMLDialogElement&&record.target.open){
     animate(record.target,{opacity:[0,1],scale:[.975,1],y:[10,0]},{duration:.28,ease:motionEase});continue;
    }
    for(const node of Array.from(record.addedNodes))if(node instanceof Element){if(node.matches(selector))enter(node);node.querySelectorAll(selector).forEach(enter)}
   }
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  return()=>observer.disconnect();
 },[reduced]);
 return null;
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
 const reduced=useReducedMotion();
 return <AnimatePresence initial={false}>{message&&<motion.div key="notice" className="toast" role="status" data-motion-notice="" initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:reduced?0:.2,ease:motionEase}}>{message}{onDismiss&&<button className="icon-button" aria-label="Dismiss notice" onClick={onDismiss}><Icon name="close" size={16}/></button>}</motion.div>}</AnimatePresence>;
}

export function DrawerBackdrop({open,onClose}:{open:boolean;onClose:()=>void}){
 const reduced=useReducedMotion();
 return <AnimatePresence>{open&&<motion.button className="nav-backdrop" aria-label="Close navigation" onClick={onClose} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduced?0:.2}}/>}</AnimatePresence>;
}

export async function closeDialogElement(dialog:HTMLDialogElement|null,after?:()=>void){
 if(dialog)dialog.dataset.closing='true';
 if(dialog?.open&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)await animate(dialog,{opacity:0,scale:.98,y:6},{duration:.16,ease:motionEase});
 dialog?.close();if(dialog){dialog.style.opacity='';dialog.style.transform='';delete dialog.dataset.closing}after?.();
}

/** Native dialog semantics and focus restoration, with a short closing transition. */
export function useDialogMotion(){
 const ref=useRef<HTMLDialogElement>(null),closing=useRef(false);
 async function close(after?:()=>void){
  if(closing.current)return;closing.current=true;
  try{await closeDialogElement(ref.current,after)}finally{closing.current=false}
 }
 return {ref,close};
}
