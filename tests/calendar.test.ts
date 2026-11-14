import {it,expect} from 'vitest';
import {validateSlot,appointmentEventId} from '../apps/api/src/calendar.js';
const settings={timezone:'Asia/Karachi',weekdays:[1,2,3,4,5,6,7],opens:'09:00',closes:'17:00'};
it('validates booking timezones, opening hours and future dates',()=>{
 const now=Date.parse('2026-11-14T00:00:00Z');const slot=validateSlot('2026-11-15T10:00','2026-11-15T10:30',settings,now);expect(slot.start).toBe('2026-11-15T05:00:00.000Z');
 expect(()=>validateSlot('2026-11-15T18:00','2026-11-15T18:30',settings,now)).toThrow();
 expect(()=>validateSlot('2026-11-13T10:00','2026-11-13T10:30',settings,now)).toThrow();
 expect(()=>validateSlot('2026-11-15T10:00','2026-11-15T10:30',{...settings,weekdays:[1]},now)).toThrow();
});
it('uses a stable Google-compatible event ID for retry reconciliation',()=>{expect(appointmentEventId('12345678-1234-1234-1234-123456789abc')).toBe('appt12345678123412341234123456789abc');});
