import assert from 'node:assert/strict';
import { activityIntent } from '../src/controllers/activityIntentController';
import { decideActivityCommand, type ActivityCommand } from '../src/domain/activityCommands';
import { applyActivityEvent } from '../src/domain/activityAggregate';
import { buildActivityHistory } from '../src/domain/activityHistory';
import { dataStore } from '../src/data/store';
import type { Activity } from '../src/types';
import type { ActivityEvent } from '../src/types/activityEvents';

const base: Activity = {
  id: 'a', squadId: 's', kind: 'match', status: 'active', name: 'Match',
  startsAt: '2099-01-01T10:00:00.000Z', location: 'Field', matchFormatId: 'fmt',
  minPlayersPerTeam: 1, maxPlayersPerTeam: 3,
  teams: [{ id: 't1', name: 'Red', strength: 2, selectedPlayers: ['p1'], responsiblePersonId: 'm1', formationId: 'f1', lineup: [{ periodNumber: 1, assignments: [{ slotId: 'GK', playerId: 'p1' }] }] }],
  invitations: [{ id: 'i1', playerId: 'p1', response: 'accepted' }]
};
const response = () => ({
  statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
  status(code: number) { this.statusCode = code; return this; },
  setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  json(value: unknown) { this.body = value; return this; }
});

const main = async (): Promise<void> => {
  const names = ['getActivityById', 'getActivityRevision', 'executeActivityIntent', 'getGroupMemberIds', 'getGroupFormations', 'getGroupPlayingModes', 'getShirtSetById'] as const;
  const original = Object.fromEntries(names.map(name => [name, dataStore[name]]));
  let current = base;
  let revision = 1;
  let lastCommand: ActivityCommand | undefined;
  let lastEvents: ActivityEvent['events'] = [];
  let writes = 0;
  try {
    (dataStore as any).getActivityById = async () => current;
    (dataStore as any).getActivityRevision = async () => revision;
    (dataStore as any).getGroupMemberIds = async () => ['m1', 'p1', 'p2'];
    (dataStore as any).getGroupFormations = async () => [{ id: 'f1', name: 'One', slots: [{ id: 'GK', positionCode: 'GK' }] }];
    (dataStore as any).getGroupPlayingModes = async () => [{ id: 'fmt', name: 'One', numberOfPeriods: 2, periodLengthMinutes: 20, minimumPeriodsPerPlayer: 0, playersOnField: 1 }];
    (dataStore as any).getShirtSetById = async () => ({ id: 'set1', groupId: 's', sponsor: '', color: 'red', shirts: [{ number: 8, size: 'M', isGoalkeeper: false }] });
    (dataStore as any).executeActivityIntent = async (activity: Activity, command: ActivityCommand) => {
      writes += 1;
      lastCommand = command;
      lastEvents = decideActivityCommand(activity, command);
      let next: Activity | null = activity;
      for (const event of lastEvents) next = applyActivityEvent(next, false, event as import('../src/types/activityEvents').ActivityDomainEvent).activity;
      current = next!;
      if (lastEvents.length) revision += 1;
      return current;
    };
    const call = async (intent: Parameters<typeof activityIntent>[0], body: unknown, params: Record<string, string> = {}) => {
      const res = response();
      await activityIntent(intent)({ params: { groupId: 's', id: 'a', teamId: 't1', playerId: 'p1', ...params }, body } as any, res as any);
      return res;
    };
    const reset = (activity = base) => { current = structuredClone(activity); revision = 1; lastCommand = undefined; lastEvents = []; writes = 0; };
    const accepted = async (intent: Parameters<typeof activityIntent>[0], body: unknown, expectedType: string, params: Record<string, string> = {}) => {
      const res = await call(intent, body, params);
      assert.equal(res.statusCode, 200, `${intent}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, current);
      assert.equal(res.headers.ETag, `"activity-revision-${revision}"`);
      assert.equal(lastCommand?.type, expectedType);
      assert.equal(writes, 1);
    };

    reset(); await accepted('details', { location: null }, 'PatchActivityDetails'); assert.equal(current.location, undefined);
    reset(); await accepted('details', { location: 'Field' }, 'PatchActivityDetails'); assert.equal(lastEvents.length, 0); assert.equal(revision, 1);
    reset({ ...base, kind: 'tournament', teams: [{ ...base.teams[0], lineup: undefined }] }); await accepted('addTeam', { id: 't2', name: 'Blue' }, 'AddTeam'); assert.equal(current.teams.length, 2);
    reset(); await accepted('teamDetails', { name: 'Blue', meetingTime: '08:45' }, 'PatchTeamDetails'); assert.equal(current.teams[0].name, 'Blue');
    reset(); await accepted('responsible', { responsiblePersonId: null }, 'SetResponsiblePerson'); assert.equal(current.teams[0].responsiblePersonId, undefined);
    reset(); await accepted('formation', { formationId: null }, 'SetFormation'); assert.equal(current.teams[0].formationId, undefined);
    reset(); await accepted('shirts', { shirtSetId: 'set1', assignments: [{ playerId: 'p1', shirtNumber: 8 }] }, 'SetShirts'); assert.equal(current.teams[0].shirtAssignments?.[0].shirtNumber, 8);
    reset(); await accepted('lineup', { periods: [{ periodNumber: 2, assignments: [{ slotId: 'GK', playerId: 'p1' }] }] }, 'SetLineup'); assert.equal(current.teams[0].lineup?.[0].periodNumber, 2);
    reset(); await accepted('selection', { add: [], remove: [{ playerId: 'p1' }] }, 'ChangeSelection'); assert.deepEqual(current.teams[0].selectedPlayers, []); assert.deepEqual(current.teams[0].lineup?.[0].assignments, []);
    reset(); await accepted('addInvitations', { players: [{ playerId: 'p2', response: 'open' }] }, 'AddInvitations'); assert.equal(current.invitations[1].playerId, 'p2');
    reset(); await accepted('removeInvitation', undefined, 'RemoveInvitation'); assert.deepEqual(lastEvents.map(event => event.type), ['InvitationRemoved', 'PlayerUnselected', 'LineupChanged']);
    reset({ ...base, startsAt: '2020-01-01T10:00:00.000Z' });
    await accepted('attendance', { changes: [{ personId: 'p1', status: 'excused', reason: 'sick' }] }, 'PatchAttendance');
    assert.deepEqual(current.attendance, [{ personId: 'p1', status: 'excused', reason: 'sick' }]);
    assert.equal(lastEvents[0].schemaVersion, 2);
    const history = buildActivityHistory([
      { _id: 'c1', streamId: 'activity:squad-s:activity-a', aggregateType: 'activity', aggregateId: 'a', squadId: 's', revision: 1, command: { type: 'Create', idempotencyKey: null, requestHash: 'h' }, actor: { type: 'system' }, recordedAt: '2020-01-01T10:00:00.000Z', correlationId: 'c', events: decideActivityCommand(null, { type: 'CreateActivity', activity: { ...base, startsAt: '2020-01-01T10:00:00.000Z' } }) },
      { _id: 'c2', streamId: 'activity:squad-s:activity-a', aggregateType: 'activity', aggregateId: 'a', squadId: 's', revision: 2, command: { type: 'PatchAttendance', idempotencyKey: null, requestHash: 'h' }, actor: { type: 'system' }, recordedAt: '2020-01-01T11:00:00.000Z', correlationId: 'c', events: lastEvents }
    ]);
    assert.deepEqual(history.items[0].changes.map(change => change.field), ['status', 'reason']);

    reset(); assert.equal((await call('details', { teams: [] })).statusCode, 400); assert.equal(writes, 0);
    reset(); assert.equal((await call('addTeam', { id: 't2', name: 'Blue' })).statusCode, 400); assert.equal(writes, 0);
    reset(); assert.equal((await call('teamDetails', { name: 'Blue' }, { teamId: 'missing' })).statusCode, 404); assert.equal(writes, 0);
    reset(); assert.equal((await call('teamDetails', { selectedPlayers: [] })).statusCode, 400); assert.equal(writes, 0);
    reset(); assert.equal((await call('responsible', { responsiblePersonId: 'outsider' })).statusCode, 400); assert.equal(writes, 0);
    reset(); assert.equal((await call('formation', { formationId: 'missing' })).statusCode, 404); assert.equal(writes, 0);
    reset(); assert.equal((await call('shirts', { shirtSetId: 'set1', assignments: [{ playerId: 'p1', shirtNumber: 8 }, { playerId: 'p1', shirtNumber: 8 }] })).statusCode, 400); assert.equal(writes, 0);
    reset(); assert.equal((await call('lineup', { periods: [{ periodNumber: 1, assignments: [{ slotId: 'BAD', playerId: 'p1' }] }] })).statusCode, 400); assert.equal(writes, 0);
    reset(); assert.equal((await call('selection', { add: ['p2'], remove: [] })).statusCode, 400); assert.equal(writes, 0);
    reset(); assert.equal((await call('addInvitations', { players: [{ playerId: 'p1', response: 'open' }] })).statusCode, 400); assert.equal(writes, 0);
    reset(); assert.equal((await call('removeInvitation', undefined, { playerId: 'missing' })).statusCode, 404); assert.equal(writes, 0);
    reset(); assert.equal((await call('attendance', { changes: [{ personId: 'p1', status: 'excused', reason: 'sick' }] })).statusCode, 400); assert.equal(writes, 0);
    reset({ ...base, startsAt: '2020-01-01T10:00:00.000Z' }); assert.equal((await call('selection', { add: [], remove: [{ playerId: 'p1' }] })).statusCode, 400); assert.equal(writes, 0);
    reset({ ...base, startsAt: '2020-01-01T10:00:00.000Z' }); assert.equal((await call('attendance', { changes: [{ personId: 'p1', status: 'excused', reason: '' }] })).statusCode, 400); assert.equal(writes, 0);
    reset({ ...base, startsAt: '2020-01-01T10:00:00.000Z' }); assert.equal((await call('attendance', { changes: [{ personId: 'p2', status: 'excused' }] })).statusCode, 400); assert.equal(writes, 0);
    console.log('Activity intent endpoint tests passed');
  } finally {
    for (const name of names) (dataStore as any)[name] = original[name];
  }
};
void main();
