import {z} from 'zod';
import {DateTime} from 'luxon';
const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
export const bookingScheduleSchema=z.object({
 timezone:z.string().refine(v=>DateTime.now().setZone(v).isValid,'Choose a valid timezone such as Asia/Karachi'),
 bookingEnabled:z.boolean(),weekdays:z.array(z.number().int().min(1).max(7)).min(1,'Select at least one day').max(7),
 opens:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Choose a valid opening time'),
 closes:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Choose a valid closing time'),
 durationMinutes:z.number().int().min(10).max(240)
}).strict().refine(v=>v.closes>v.opens,'Closing time must follow opening time').refine(v=>minutes(v.closes)-minutes(v.opens)>=v.durationMinutes,'The appointment length must fit inside your opening hours');
export async function saveClinicSchedule(db:any,org:string,body:unknown){
 const settings=bookingScheduleSchema.parse(body);
 const row=(await db.query('select status from calendar_connections where organization_id=$1 for update',[org])).rows[0];
 if(!row||settings.bookingEnabled&&row.status!=='connected')throw new z.ZodError([{code:'custom',path:['bookingEnabled'],message:'Google Calendar must be connected before booking can be enabled.'}]);
 await db.query('update calendar_connections set timezone=$2,booking_enabled=$3,weekdays=$4,opens=$5,closes=$6,duration_minutes=$7 where organization_id=$1',[org,settings.timezone,settings.bookingEnabled,[...new Set(settings.weekdays)],settings.opens,settings.closes,settings.durationMinutes]);return {ok:true};
}
