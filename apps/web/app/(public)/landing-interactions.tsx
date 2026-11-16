"use client";
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import {useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {Icon} from '../icons';
import {motionEase} from '../ui/motion';

export function MobileNavigation(){
 const [open,setOpen]=useState(false),id=useId(),reduced=useReducedMotion(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[open]);
 return <div ref={root} className="mobile-navigation"><button ref={trigger} className="mobile-nav-trigger" aria-label={open?'Close navigation':'Open navigation'} aria-controls={id} aria-expanded={open} onClick={()=>setOpen(!open)}><Icon name={open?'close':'menu'} size={20}/></button><AnimatePresence initial={false}>{open&&<motion.nav id={id} aria-label="Mobile navigation" className="mobile-nav-panel" initial={reduced?false:{opacity:0,y:-7,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-5,scale:.98}} transition={{duration:.2,ease:motionEase}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false)}}>{[['/#features','Features'],['/#how-it-works','How it works'],['/#integrations','Integrations'],['/privacy','Privacy'],['/support','Support']].map(([href,label])=><Link key={href} href={href} onClick={()=>setOpen(false)}>{label}<Icon name="arrow" size={15}/></Link>)}</motion.nav>}</AnimatePresence></div>;
}

export function FAQ({items}:{items:[string,string][]}){
 const [open,setOpen]=useState<number|null>(null),id=useId(),reduced=useReducedMotion();
 return <div className="crafted-faq-list">{items.map(([question,answer],i)=><div className={'faq-item '+(open===i?'is-open':'')} key={question}><h3><button id={`${id}-q${i}`} aria-expanded={open===i} aria-controls={`${id}-a${i}`} onClick={()=>setOpen(open===i?null:i)}>{question}<motion.span animate={{rotate:open===i?45:0}} transition={{duration:reduced?0:.18}}><Icon name="plus" size={18}/></motion.span></button></h3><AnimatePresence initial={false}>{open===i&&<motion.div key="answer" id={`${id}-a${i}`} role="region" aria-labelledby={`${id}-q${i}`} initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:reduced?0:.28,ease:motionEase}} className="faq-answer"><p>{answer}</p></motion.div>}</AnimatePresence></div>)}</div>;
}
