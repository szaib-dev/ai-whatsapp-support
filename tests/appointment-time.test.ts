import {expect,it} from 'vitest';
import {localInput,zonedISO} from '../apps/web/lib/appointment-time.js';

it.each([
 ['2026-11-17T09:00','Asia/Karachi','2026-11-17T04:00:00.000Z'],
 ['2026-11-17T01:00','Asia/Karachi','2026-11-16T20:00:00.000Z'],
 ['2026-11-17T09:00','Asia/Kolkata','2026-11-17T03:30:00.000Z'],
 ['2026-07-17T09:00','America/New_York','2026-07-17T13:00:00.000Z'],
 ['2026-11-17T09:00','America/New_York','2026-11-17T14:00:00.000Z'],
])('interprets %s in %s independently of browser timezone', (local,zone,utc)=>{
 expect(zonedISO(local,zone)).toBe(utc);
 expect(localInput(utc,zone)).toBe(local);
});
it('rejects a nonexistent daylight-saving wall time instead of silently moving the appointment',()=>{
 expect(()=>zonedISO('2027-03-14T02:30','America/New_York')).toThrow('does not exist');
});
