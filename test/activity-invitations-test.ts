import assert from 'node:assert/strict';
import { updateActivity, updateActivityInvitations } from '../src/controllers/activityController';
import { dataStore } from '../src/data/store';
import type { Activity } from '../src/types';

const original = {
  getActivityById: dataStore.getActivityById,
  getActivityRevision: dataStore.getActivityRevision,
  updateActivity: dataStore.updateActivity
};
const activity: Activity = {
  id: 'activity-1', spondId: 'spond-1', squadId: 'squad-1', kind: 'match', status: 'active', name: 'Match',
  startsAt: '2026-10-10T12:30:00.000Z', minPlayersPerTeam: 1, maxPlayersPerTeam: 11,
  invitations: [], teams: [{ id: 'team-1', name: 'Blue', strength: 2, selectedPlayers: [] }]
};
const response = () => ({
  statusCode: 200, body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  setHeader() { return this; },
  json(value: unknown) { this.body = value; return this; }
});
const request = (invitations: unknown) => ({
  params: { groupId: 'squad-1', id: 'activity-1' },
  body: { invitations }
}) as any;

const main = async (): Promise<void> => {
  let saved: Activity | undefined;
  try {
    (dataStore as any).getActivityById = async () => activity;
    (dataStore as any).getActivityRevision = async () => 1;
    (dataStore as any).updateActivity = async (value: Activity) => { saved = value; return value; };

    const invitations = [{ id: 'inv-1', playerId: 'player-1', response: 'open' }];
    const result = response();
    await updateActivityInvitations(request(invitations), result as any);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(saved?.invitations, invitations);
    assert.equal(saved?.spondId, 'spond-1');
    assert.equal('meetingLocation' in saved!.teams[0], false);

    const invalid = response();
    await updateActivityInvitations(request([{ id: 'inv-1', playerId: 'player-1', response: 'wrong' }]), invalid as any);
    assert.equal(invalid.statusCode, 400);

    const duplicate = response();
    await updateActivityInvitations(request([...invitations, ...invitations]), duplicate as any);
    assert.equal(duplicate.statusCode, 400);

    const withNullMeetingLocation = { ...activity, teams: [{ ...activity.teams[0], meetingLocation: null }] };
    (dataStore as any).getActivityById = async () => withNullMeetingLocation;
    const legacy = response();
    await updateActivity({ ...request(invitations), body: { invitations } } as any, legacy as any);
    assert.equal(legacy.statusCode, 200);
    assert.equal('meetingLocation' in saved!.teams[0], false);

    const invalidLocation = response();
    await updateActivity({ ...request(invitations), body: {
      teams: [{ ...activity.teams[0], meetingLocation: 42 }]
    } } as any, invalidLocation as any);
    assert.equal(invalidLocation.statusCode, 400);

    const selectedActivity = {
      ...activity,
      invitations: [{ id: 'inv-1', playerId: 'player-1', response: 'accepted' as const }],
      teams: [{ ...activity.teams[0], selectedPlayers: ['player-1'] }]
    };
    (dataStore as any).getActivityById = async () => selectedActivity;
    const removal = response();
    await updateActivityInvitations(request([]), removal as any);
    assert.equal(removal.statusCode, 200);
    assert.deepEqual(saved?.invitations, []);
    assert.deepEqual(saved?.teams[0].selectedPlayers, []);

    console.log('Activity invitations tests passed');
  } finally {
    (dataStore as any).getActivityById = original.getActivityById;
    (dataStore as any).getActivityRevision = original.getActivityRevision;
    (dataStore as any).updateActivity = original.updateActivity;
  }
};
void main();
