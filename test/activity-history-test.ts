import assert from 'node:assert/strict';
import { buildActivityHistory } from '../src/domain/activityHistory';
import { decideActivityCommand } from '../src/domain/activityCommands';
import type { Activity } from '../src/types';
import type { ActivityEvent } from '../src/types/activityEvents';

const initial: Activity = {
  id: 'a1', squadId: 's1', kind: 'match', status: 'active', name: 'Match',
  startsAt: '2026-01-01T09:00:00.000Z', teams: [{ id: 't1', name: 'Red', strength: 2, selectedPlayers: ['p1'], lineup: [{ periodNumber: 1, assignments: [{ slotId: 'GK', playerId: 'p1' }] }] }],
  invitations: [{ id: 'i1', playerId: 'p1', response: 'accepted' }]
};
const changed: Activity = {
  ...initial, name: 'New Match', location: 'Field',
  invitations: [{ ...initial.invitations[0], response: 'declined' }],
  teams: [{ ...initial.teams[0], name: 'Blue', selectedPlayers: [], lineup: [{ periodNumber: 1, assignments: [] }] }]
};
const commit = (revision: number, events: ActivityEvent['events']): ActivityEvent => ({
  _id: `commit-${revision}`, streamId: 'activity:squad-s1:activity-a1', aggregateType: 'activity',
  aggregateId: 'a1', squadId: 's1', revision, command: { type: 'Test', idempotencyKey: null, requestHash: 'h' },
  actor: { type: 'user', memberId: 'm1' }, recordedAt: `2026-01-0${revision}T10:00:00.000Z`, correlationId: 'c', events
});
const commits = [
  commit(1, decideActivityCommand(null, { type: 'CreateActivity', activity: initial })),
  commit(2, decideActivityCommand(initial, { type: 'UpdateActivity', activity: changed }))
];
const page = buildActivityHistory(commits, new Map([['m1', 'Coach'], ['p1', 'Player']]));
assert.deepEqual(page.items.map(item => item.revision), [2, 1]);
assert.equal(page.items[0].actor.displayName, 'Coach');
assert.deepEqual(page.items[0].changes.map(change => change.type), [
  'activity.detailsChanged', 'activity.detailsChanged', 'invitation.responseChanged',
  'team.detailsChanged', 'selection.playerRemoved', 'lineup.changed'
]);
assert.equal(page.items[0].changes[0].previous, 'Match');
assert.equal(page.items[0].changes[1].previous, null);
assert.equal(page.items[0].changes[1].current, 'Field');
assert.equal(page.items[0].changes[4].subject.displayName, 'Player');
assert.deepEqual(page.items[0].changes[5].context, { periods: [1], assignmentChanges: 1 });
const oldVersion = buildActivityHistory([commit(1, [{ ordinal: 0, type: 'TaskCreated', schemaVersion: 0, data: {} }])]);
assert.equal(oldVersion.items[0].changes[0].type, 'event.unsupported');
const deleted = buildActivityHistory([...commits, commit(3, decideActivityCommand(changed, { type: 'DeleteActivity' }))]);
assert.equal(deleted.items[0].changes[0].type, 'activity.deleted');
assert.equal(deleted.items[0].changes[0].subject.displayName, 'New Match');
const cleared = buildActivityHistory([...commits, commit(3, decideActivityCommand(changed, { type: 'PatchActivityDetails', changes: { location: undefined } }))]);
assert.equal(cleared.items[0].changes[0].previous, 'Field');
assert.equal(cleared.items[0].changes[0].current, null);
const oldAttendance = buildActivityHistory([
  commit(1, decideActivityCommand(null, { type: 'CreateActivity', activity: initial })),
  commit(2, [{ ordinal: 0, type: 'AttendanceRecorded', schemaVersion: 1, data: { personId: 'p1', status: 'present' } }])
]);
assert.equal(oldAttendance.items[0].changes[0].field, 'status');
assert.equal(oldAttendance.items[0].changes[0].current, 'present');
assert.equal(buildActivityHistory([commit(1, [{ ordinal: 0, type: 'ActivityCreated', schemaVersion: 99, data: initial }])]).items[0].changes[0].type, 'event.unsupported');

const imported: Activity = { ...initial, kind: 'tournament', teams: [{ id: 't1', name: 'Red', strength: 2, selectedPlayers: [] }], invitations: [], attendance: [] };
const expanded: Activity = { ...imported, invitations: [{ id: 'i1', playerId: 'p1', response: 'accepted' }], teams: [...imported.teams, { id: 't2', name: 'Blue', strength: 2, selectedPlayers: [] }] };
const selected: Activity = { ...expanded, teams: [{ ...expanded.teams[0], selectedPlayers: ['p1'] }, expanded.teams[1]], selectionSentAt: '2026-01-02T10:00:00.000Z', attendance: [{ personId: 'p1', status: 'present' }] };
const contracted: Activity = { ...selected, invitations: [], teams: [{ ...selected.teams[0], selectedPlayers: [] }], attendance: [] };
const sequence = buildActivityHistory([
  commit(1, decideActivityCommand(null, { type: 'ImportActivity', activity: imported })),
  commit(2, decideActivityCommand(imported, { type: 'UpdateActivity', activity: expanded })),
  commit(3, decideActivityCommand(expanded, { type: 'UpdateActivity', activity: selected })),
  commit(4, decideActivityCommand(selected, { type: 'UpdateActivity', activity: contracted }))
]);
assert.deepEqual(sequence.items.map(item => item.changes.map(change => change.type)), [
  ['invitation.removed', 'team.removed', 'selection.playerRemoved', 'attendance.removed'],
  ['selection.playerAdded', 'selection.markedSent', 'attendance.changed'],
  ['invitation.added', 'team.added'],
  ['activity.imported']
]);
assert.equal(sequence.items[0].changes[1].subject.displayName, 'Blue');
assert.equal(sequence.items[0].changes[2].subject.displayName, null);
console.log('Activity history tests passed');
