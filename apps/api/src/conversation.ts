import type {Context} from './ai.js';
export type ConversationIntent='confirmation'|'cancellation'|'calendar_question'|'booking_request'|'booking_followup'|'other';
const booking=/\b(?:want|need|like|can (?:i|we) (?:get|have))\b.{0,40}\b(?:appointment|meeting|consultation|booking)\b|\b(?:book|schedule|arrange|reserve|set up)\b.{0,50}\b(?:appointment|meeting|consultation|visit|slot)\b|\b(?:appointment|meeting|consultation|mulaqat)\b.{0,35}\b(?:book|schedule|chahiye|chahta|chahte|rakh|karwa|karni|leni)\b|\b(?:book|schedule)\s+(?:me|us|it|one|for|tomorrow|today|aaj|kal)\b|(?:اپائنٹمنٹ|ملاقات).{0,30}(?:چاہیے|لینی|رکھ|بک)|(?:بک|طے).{0,30}(?:اپائنٹمنٹ|ملاقات)/i;
const calendarQuestion=/\b(?:how many|how much|number of|count|list|show|existing|already|my|your|today'?s)\b.{0,65}\b(?:meetings?|appointments?|bookings?|calendar|schedule)\b|\b(?:meetings?|appointments?|bookings?|calendar)\b.{0,55}\b(?:how many|kitn[aeiy]|list|today|aaj|hain|meri|mera|existing|already)\b|\b(?:kitn[aeiy]|meri|mera|aap\s*k[iae])\b.{0,50}\b(?:meetings?|appointments?|bookings?|calendar|mulaqat)\b|(?:کتنی|کتنے|میری|آپ کی).{0,45}(?:میٹنگ|ملاقات|اپائنٹمنٹ|بکنگ|کیلنڈر)/i;
export function isBookingRequest(text:string){return /can I (?:come|visit)|(?:kal|aaj).*\d.*(?:appointment|time|waqt).*(?:mil|chahiye)|(?:کیا|کل|آج).*(?:بجے|وقت).*(?:مل|دستیاب)/i.test(text)||booking.test(text)||/^\s*(?:an?\s+)?(?:appointment|booking|meeting|consultation|mulaqat)\s*[.!]?\s*$/i.test(text)||/\b(?:available|availability|free slot)\b.{0,55}\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(text)}
export function isTemporalAnswer(text:string){
 // A bare date/time can resume a booking. A date embedded in another question cannot.
 if(/[?؟]|\b(?:how|what|where|why|who|price|cost|fee|address|location|open|close|service|treatment|kitn[aeiy]|kahan|kyun|kya)\b|قیمت|کہاں|کیوں|کتن/i.test(text))return false;
 const rest=text.toLowerCase().replace(/(\d)(am|pm)\b/g,'$1 $2').replace(/\b(\d+)(?:st|nd|rd|th)\b/g,'$1').replace(/\b(?:today|tomorrow|tonight|next|this|on|at|for|around|please|instead|make it|aaj|kal|parson|baje|bajay|ko|subah|shaam|raat|dopahar|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|am|pm)\b/g,'').replace(/آج|کل|پرسوں|بجے|صبح|شام|رات|دوپہر|کو|پیر|منگل|بدھ|جمعرات|جمعہ|ہفتہ|اتوار/g,'').replace(/[\d\s:.,/\-+!]/g,'');
 return rest.length===0&&/\d|today|tomorrow|tonight|aaj|kal|parson|monday|tuesday|wednesday|thursday|friday|saturday|sunday|آج|کل|پرسوں|پیر|منگل|بدھ|جمعرات|جمعہ|ہفتہ|اتوار/i.test(text);
}
export function bookingHistory(c:Context){
 let start=-1;
 for(let i=0;i<c.history.length;i++){
  const m=c.history[i];
  if(m.sender==='customer'&&isBookingRequest(m.content))start=i;
  if((m.sender==='customer'&&/^(?:never mind|nevermind|forget (?:it|the booking)|cancel(?: it| booking)?|rehne do|رہنے دیں)[.!]?$/i.test(m.content.trim()))||(m.sender==='ai'&&/appointment is booked|you’re booked|you.re booked|request is cancelled|unconfirmed request|appointment.*book ho gayi|request cancelled|darkhwast cancel|اپائنٹمنٹ.*بک ہو گئی/i.test(m.content)))start=-1;
 }
 // Only booking-relevant customer turns supply slot preferences. Side topics stay in general memory.
 return start<0?[]:c.history.slice(start).filter(m=>m.sender==='customer'&&(isBookingRequest(m.content)||isTemporalAnswer(m.content)));
}
export function conversationIntent(c:Context,text:string):ConversationIntent{
 if(/^confirm\b/i.test(text.trim()))return 'confirmation';
 if(/^cancel\b/i.test(text.trim()))return 'cancellation';
 // Reporting on calendar contents never falls through to slot extraction, even with a prior booking.
 if(calendarQuestion.test(text)&&(!isBookingRequest(text)||/how many|number of|count|\blist\b|\bshow\b|kitn[aeiy]|کتن/i.test(text)))return 'calendar_question';
 if(/^(?:yes(?: please)?|confirm(?: it)?|ji|haan|han|جی|ہاں|کنفرم)[.!؟?]*$/i.test(text.trim())&&bookingHistory(c).length)return 'booking_followup';
 if(isBookingRequest(text))return 'booking_request';
 if(/alternative|another time|aur waqt|دوسرا وقت/i.test(text)&&bookingHistory(c).length)return 'booking_followup';
 if(isTemporalAnswer(text)&&bookingHistory(c).length)return 'booking_followup';
 return 'other';
}
export function explicitHandoff(text:string){return /\b(?:speak|talk|connect|transfer|chat)\b.{0,35}\b(?:human|person|staff|owner|receptionist|team|agent)\b|\b(?:human|staff|owner|receptionist)\b.{0,25}\b(?:please|chahiye|baat|rabta)\b|(?:عملے|مالک|انسان|ریسپشن).{0,25}(?:بات|رابطہ)/i.test(text)}
