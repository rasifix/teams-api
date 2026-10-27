import assert from 'node:assert/strict';
import { updateActivityAttendance, updateActivityInvitation, updateActivitySelection } from '../src/controllers/activityController';
import { dataStore } from '../src/data/store';
import type { Activity } from '../src/types';

const activity: Activity = {
  id: 'a', squadId: 's', kind: 'match', status: 'active', name: 'Match',
  startsAt: '2020-01-01T10:00:00.000Z', minPlayersPerTeam: 1, maxPlayersPerTeam: 11,
  teams: [{ id: 't', name: 'Red', strength: 2, selectedPlayers: ['p'] }],
  invitations: [{ id: 'i', playerId: 'p', response: 'accepted' }]
};
const response = () => ({
  statusCode: 200, body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  setHeader() { return this; },
  json(value: unknown) { this.body = value; return this; }
});
const request = (body: unknown) => ({ params: { groupId: 's', id: 'a', playerId: 'p' }, body }) as any;

const main = async (): Promise<void> => {
  const originalGet = dataStore.getActivityById;
  const originalRevision = dataStore.getActivityRevision;
  const originalUpdate = dataStore.updateActivity;
  let current = activity;
  let writes = 0;
  try {
    (dataStore as any).getActivityById = async () => current;
    (dataStore as any).getActivityRevision = async () => 1;
    (dataStore as any).updateActivity = async (value: Activity) => { writes += 1; return value; };
    const declined = response();
    await updateActivityInvitation(request({ response: 'declined' }), declined as any);
    assert.equal(declined.statusCode, 400);
    const removed = response();
    await updateActivitySelection(request({ teams: [{ ...activity.teams[0], selectedPlayers: [] }] }), removed as any);
    assert.equal(removed.statusCode, 400);
    current = { ...activity, startsAt: '2099-01-01T10:00:00.000Z' };
    const earlyAttendance = response();
    await updateActivityAttendance(request({ attendance: [{ personId: 'p', status: 'present' }] }), earlyAttendance as any);
    assert.equal(earlyAttendance.statusCode, 400);
    current = { ...current, attendance: [{ personId: 'p', status: 'present' }] };
    const removedWithAttendance = response();
    await updateActivitySelection(request({ teams: [{ ...activity.teams[0], selectedPlayers: [] }] }), removedWithAttendance as any);
    assert.equal(removedWithAttendance.statusCode, 400);
    assert.equal(writes, 0);
    console.log('Activity timing controller tests passed');
  } finally {
    (dataStore as any).getActivityById = originalGet;
    (dataStore as any).getActivityRevision = originalRevision;
    (dataStore as any).updateActivity = originalUpdate;
  }
};
void main();
