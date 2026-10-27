import assert from 'node:assert/strict';
import { attendanceTimingError, selectionTimingError } from '../src/domain/activitySelectionPolicy';
import type { Activity } from '../src/types';

const now = Date.parse('2026-10-27T10:00:00.000Z');
const activity: Activity = {
  id: 'a', squadId: 's', kind: 'match', status: 'active', name: 'Match',
  startsAt: '2026-10-28T10:00:00.000Z',
  teams: [{ id: 't', name: 'Red', strength: 2, selectedPlayers: ['p'] }],
  invitations: [{ id: 'i', playerId: 'p', response: 'accepted' }]
};
const unselected: Activity = { ...activity, teams: [{ ...activity.teams[0], selectedPlayers: [] }] };
assert.equal(attendanceTimingError(activity, now), 'Attendance can only be recorded after the activity starts');
assert.equal(attendanceTimingError({ ...activity, startsAt: '2026-10-27T09:00:00.000Z' }, now), null);
assert.equal(selectionTimingError(activity, unselected, now), null);
assert.match(selectionTimingError({ ...activity, startsAt: '2026-10-27T09:00:00.000Z' }, unselected, now) ?? '', /Selection cannot change/);
assert.match(selectionTimingError({ ...activity, attendance: [{ personId: 'p', status: 'present' }] }, unselected, now) ?? '', /Selection cannot change/);
assert.equal(selectionTimingError({ ...activity, startsAt: '2026-10-27T09:00:00.000Z' }, activity, now), null);
console.log('Activity selection and attendance timing tests passed');
