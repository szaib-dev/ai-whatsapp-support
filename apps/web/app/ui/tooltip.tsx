"use client";
import {cloneElement,useId,type ReactElement} from 'react';
export function Tooltip({label,children}:{label:string;children:ReactElement<{'aria-describedby'?:string}>}){const id=useId();return <span className="tooltip">{cloneElement(children,{'aria-describedby':id})}<span className="tooltip-content" id={id} role="tooltip">{label}</span></span>}
