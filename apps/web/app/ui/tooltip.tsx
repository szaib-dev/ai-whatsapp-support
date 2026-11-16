"use client";
import type {ReactNode} from 'react';import {Tooltip as Root,TooltipContent,TooltipTrigger} from '@/components/ui/tooltip';
export function Tooltip({label,children}:{label:string;children:ReactNode}){return <Root><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Root>}
