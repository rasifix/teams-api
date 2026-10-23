import assert from 'node:assert/strict';
import { ActivityCommandError, decideActivityCommand } from '../src/domain/activityCommands';
import type { Activity } from '../src/types';

const activity: Activity = {
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Initial name',
  startsAt: '2026-11-04T18:00:00.000Z',
  teams: [{ id: 'team-1', name: 'Team 1', strength: 2, selectedPlayers: [], lineup: [] }],
  invitations: [{ id: 'invitation-1', playerId: 'player-1', response: 'open' }]
};

const main = (): void => {
  assert.equal(decideActivityCommand(null, { type: 'CreateActivity', activity })[0].type, 'ActivityCreated');
  assert.equal(decideActivityCommand(null, { type: 'ImportActivity', activity })[0].type, 'ActivityImported');

  const next = {
    ...activity,
    name: 'Updated name',
    invitations: [{ id: 'invitation-1', playerId: 'player-1', response: 'accepted' as const }],
    teams: [{ ...activity.teams[0], selectedPlayers: ['player-1'] }]
  };
  const changes = decideActivityCommand(activity, { type: 'UpdateActivity', activity: next });
  assert.deepEqual(changes.map(change => change.type), [
    'ActivityDetailsChanged',
    'InvitationResponseChanged',
    'PlayerSelected'
  ]);

  assert.deepEqual(decideActivityCommand(activity, { type: 'UpdateActivity', activity }), []);
  assert.equal(decideActivityCommand(activity, { type: 'DeleteActivity' })[0].type, 'ActivityDeleted');
  assert.equal(decideActivityCommand(activity, {
    type: 'PublishSelection',
    selectionSentAt: '2026-01-01T12:00:00.000Z'
  })[0].type, 'SelectionPublished');

  assert.throws(
    () => decideActivityCommand(null, { type: 'DeleteActivity' }),
    ActivityCommandError
  );
  assert.throws(
    () => decideActivityCommand(activity, {
      type: 'UpdateActivity',
      activity: { ...activity, id: 'other-activity' }
    }),
    ActivityCommandError
  );
  console.log('Activity command tests passed');
};

main();
