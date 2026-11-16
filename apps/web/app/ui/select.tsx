"use client";
import {Children,isValidElement,type ReactNode} from 'react';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
export function AppSelect({value,onChange,children,disabled,'aria-label':label}:{value:string;onChange:(event:{target:{value:string}})=>void;children:ReactNode;disabled?:boolean;'aria-label'?:string}){
 const options:{value:string;label:ReactNode}[]=[];
 function collect(nodes:ReactNode){Children.forEach(nodes,node=>{if(Array.isArray(node))collect(node);else if(isValidElement<{value?:string;children?:ReactNode}>(node)){if(node.type==='option'){const v=String(node.props.value??node.props.children??'');if(v)options.push({value:v,label:node.props.children})}else collect(node.props.children)}})}collect(children);
 return <Select value={value} onValueChange={v=>onChange({target:{value:v}})} disabled={disabled||!options.length}><SelectTrigger aria-label={label||'Choose an option'} className="select-trigger"><SelectValue placeholder="Select an option"/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;
}
