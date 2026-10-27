import assert from 'node:assert/strict';
import { decideActivityCommand } from '../src/domain/activityCommands';
import { replayActivityEvents } from '../src/domain/activityAggregate';
import { buildActivityHistory } from '../src/domain/activityHistory';
import type { Activity } from '../src/types';
import type { ActivityEvent } from '../src/types/activityEvents';

const activity: Activity = {
  id: 'a', squadId: 's', kind: 'match', status: 'active', name: 'Match', startsAt: '2026-01-01T09:00:00.000Z',
  invitations: [{ id: 'i', playerId: 'p', response: 'accepted' }],
  teams: [{ id: 't', name: 'Red', strength: 2, selectedPlayers: ['p'], lineup: [{ periodNumber: 1, assignments: [{ slotId: 'GK', playerId: 'p' }] }] }]
};
const created = decideActivityCommand(null, { type: 'CreateActivity', activity });
const removed = decideActivityCommand(activity, { type: 'RemoveInvitation', playerId: 'p' });
assert.deepEqual(removed.map(item => item.type), ['InvitationRemoved', 'PlayerUnselected', 'LineupChanged']);
const commit = (revision: number, events: ActivityEvent['events']): ActivityEvent => ({
  _id: `c${revision}`, streamId: 'activity:squad-s:activity-a', aggregateType: 'activity', aggregateId: 'a', squadId: 's', revision,
  command: { type: 'Test', idempotencyKey: null, requestHash: 'h' }, actor: { type: 'system' },
  recordedAt: '2026-01-01T12:00:00.000Z', correlationId: 'c', events
});
const commits = [commit(1, created), commit(2, removed)];
const replayed = replayActivityEvents(commits);
assert.deepEqual(replayed.activity?.invitations, []);
assert.deepEqual(replayed.activity?.teams[0].selectedPlayers, []);
assert.deepEqual(replayed.activity?.teams[0].lineup?.[0].assignments, []);
assert.deepEqual(buildActivityHistory(commits).items[0].changes.map(item => item.type), [
  'invitation.removed', 'selection.playerRemoved', 'lineup.changed'
]);
assert.deepEqual(decideActivityCommand(activity, { type: 'PatchActivityDetails', changes: {} }), []);
const unselected = decideActivityCommand(activity, { type: 'ChangeSelection', teamId: 't', add: [], remove: [{ playerId: 'p', reason: 'sick' }] });
assert.equal((unselected.find(item => item.type === 'PlayerUnselected')?.data as { reason?: string }).reason, 'sick');
assert.equal(typeof (unselected.find(item => item.type === 'PlayerUnselected')?.data as { removedAt?: string }).removedAt, 'string');
const attendance = decideActivityCommand(activity, { type: 'PatchAttendance', changes: [{ personId: 'p', status: 'excused', reason: 'sick' }] });
assert.equal(attendance[0].schemaVersion, 2);
const reasonReplay = replayActivityEvents([commit(1, created), commit(2, attendance)]);
assert.deepEqual(reasonReplay.activity?.attendance, [{ personId: 'p', status: 'excused', reason: 'sick' }]);
const oldAttendanceReplay = replayActivityEvents([commit(1, created), commit(2, [{ ordinal: 0, type: 'AttendanceRecorded', schemaVersion: 1, data: { personId: 'p', status: 'present' } }])]);
assert.deepEqual(oldAttendanceReplay.activity?.attendance, [{ personId: 'p', status: 'present' }]);
assert.throws(() => replayActivityEvents([commit(1, created), commit(2, [{ ordinal: 0, type: 'AttendanceRecorded', schemaVersion: 3, data: { personId: 'p', status: 'present' } }])]), /not supported/);
console.log('Activity intent command tests passed');
