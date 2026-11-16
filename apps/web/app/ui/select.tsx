"use client";
import * as Select from '@radix-ui/react-select';
import {Children,isValidElement,type ReactNode} from 'react';
import {Icon} from '../icons';
// Keep the existing controlled option lists while sharing accessible typeahead,
// keyboard navigation, focus management and portal positioning.
export function AppSelect({value,onChange,children,disabled,'aria-label':label}:{value:string;onChange:(event:{target:{value:string}})=>void;children:ReactNode;disabled?:boolean;'aria-label'?:string}){
 const options:ReactNode[]=[];
 function collect(nodes:ReactNode){Children.forEach(nodes,node=>{if(Array.isArray(node))collect(node);else if(isValidElement<{value?:string;children?:ReactNode}>(node)){if(node.type==='option'){const v=String(node.props.value??node.props.children??'');if(v)options.push(<Select.Item className="select-item" value={v} key={v}><Select.ItemText>{node.props.children}</Select.ItemText><Select.ItemIndicator><Icon name="check" size={15}/></Select.ItemIndicator></Select.Item>)}else collect(node.props.children)}})}
 collect(children);
 return <Select.Root value={value} onValueChange={v=>onChange({target:{value:v}})} disabled={disabled||!options.length}><Select.Trigger className="select-trigger" aria-label={label}><Select.Value placeholder="Select an option"/><Select.Icon><Icon name="down" size={16}/></Select.Icon></Select.Trigger><Select.Portal><Select.Content className="select-content" position="popper" sideOffset={6}><Select.ScrollUpButton className="select-scroll"><Icon name="left" size={14}/></Select.ScrollUpButton><Select.Viewport>{options}</Select.Viewport><Select.ScrollDownButton className="select-scroll"><Icon name="down" size={14}/></Select.ScrollDownButton></Select.Content></Select.Portal></Select.Root>
}
