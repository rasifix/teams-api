import assert from 'node:assert/strict';
import { replayActivityEvents, ActivityReplayError, UnsupportedActivityEventError } from '../src/domain/activityAggregate';
import type { Activity } from '../src/types';
import type { ActivityDomainEvent, ActivityEvent } from '../src/types/activityEvents';

const baseActivity: Activity = {
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Initial name',
  startsAt: '2026-11-04T18:00:00.000Z',
  teams: [{
    id: 'team-1',
    name: 'Team 1',
    strength: 2,
    selectedPlayers: [],
    lineup: []
  }],
  invitations: [{
    id: 'invitation-1',
    playerId: 'player-1',
    response: 'open'
  }]
};

const commit = (revision: number, events: ActivityDomainEvent[]): ActivityEvent<ActivityDomainEvent[]> => ({
  _id: `commit-${revision}`,
  streamId: 'activity:squad-1:activity-1',
  aggregateType: 'activity',
  aggregateId: 'activity-1',
  squadId: 'squad-1',
  revision,
  command: { type: 'TestCommand', idempotencyKey: null, requestHash: `hash-${revision}` },
  actor: { type: 'system' },
  recordedAt: `2026-01-01T00:0${revision}:00.000Z`,
  correlationId: `correlation-${revision}`,
  events
});

const event = <T extends ActivityDomainEvent['type']>(
  type: T,
  data: Extract<ActivityDomainEvent, { type: T }>['data']
): Extract<ActivityDomainEvent, { type: T }> => ({
  ordinal: 0,
  type,
  schemaVersion: 1,
  data
} as unknown as Extract<ActivityDomainEvent, { type: T }>);

const main = (): void => {
  const result = replayActivityEvents([
    commit(1, [event('ActivityImported', baseActivity)]),
    commit(2, [event('ActivityDetailsChanged', { name: 'Updated name' })]),
    commit(3, [event('InvitationResponseChanged', {
      invitationId: 'invitation-1',
      playerId: 'player-1',
      response: 'accepted'
    })]),
    commit(4, [event('PlayerSelected', { teamId: 'team-1', playerId: 'player-1' })]),
    commit(5, [event('SelectionPublished', { selectionSentAt: '2026-01-01T12:00:00.000Z' })]),
    commit(6, [event('AttendanceRecorded', { personId: 'player-1', status: 'present' })])
  ]);

  assert.equal(result.deleted, false);
  assert.equal(result.revision, 6);
  assert.equal(result.activity?.name, 'Updated name');
  assert.equal(result.activity?.invitations[0].response, 'accepted');
  assert.deepEqual(result.activity?.teams[0].selectedPlayers, ['player-1']);
  assert.equal(result.activity?.selectionSentAt, '2026-01-01T12:00:00.000Z');
  assert.deepEqual(result.activity?.attendance, [{ personId: 'player-1', status: 'present' }]);

  const checkpoint = replayActivityEvents([
    commit(1, [event('ActivityImported', baseActivity)]),
    commit(2, [event('ActivityDetailsChanged', { name: 'Updated name' })]),
    commit(3, [event('InvitationResponseChanged', {
      invitationId: 'invitation-1', playerId: 'player-1', response: 'accepted'
    })])
  ]);
  const tail = replayActivityEvents([
    commit(4, [event('PlayerSelected', { teamId: 'team-1', playerId: 'player-1' })]),
    commit(5, [event('SelectionPublished', { selectionSentAt: '2026-01-01T12:00:00.000Z' })]),
    commit(6, [event('AttendanceRecorded', { personId: 'player-1', status: 'present' })])
  ], checkpoint);
  assert.deepEqual(tail, result, 'snapshot checkpoint plus event tail must equal full replay');

  const deleted = replayActivityEvents([
    commit(1, [event('ActivityImported', baseActivity)]),
    commit(2, [event('ActivityDeleted', {})])
  ]);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.activity, null);

  assert.throws(
    () => replayActivityEvents([commit(2, [event('ActivityImported', baseActivity)])]),
    ActivityReplayError
  );
  assert.throws(
    () => replayActivityEvents([
      commit(1, [event('ActivityImported', baseActivity)]),
      commit(2, [event('TaskCreated', {})])
    ]),
    UnsupportedActivityEventError
  );
  console.log('Activity aggregate tests passed');
};

main();
