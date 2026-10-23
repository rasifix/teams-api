import assert from 'node:assert/strict';
import {
  ActivityIdempotencyConflictError,
  ActivityRevisionConflictError,
  executeActivityCommand
} from '../src/domain/activityCommandService';
import type { Activity } from '../src/types';
import type { ActivityEvent } from '../src/types/activityEvents';

const activity: Activity = {
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Initial name',
  startsAt: '2026-11-04T18:00:00.000Z',
  teams: [{ id: 'team-1', name: 'Team 1', strength: 2, selectedPlayers: [], lineup: [] }],
  invitations: []
};

const commits: ActivityEvent[] = [];
const projections: Activity[] = [];
const eventStore = {
  getLatestRevision: async () => commits.length,
  getByIdempotencyKey: async (squadId: string, key: string) =>
    commits.find(commit => commit.squadId === squadId && commit.command.idempotencyKey === key) ?? null,
  append: async (commit: ActivityEvent) => {
    commits.push({ ...commit, recordedAt: commit.recordedAt });
    return commit;
  },
  getStream: async () => commits
} as any;
const projectionStore = {
  apply: async (next: Activity) => {
    projections.push(next);
    return { applied: true, document: {} };
  }
} as any;

const main = async (): Promise<void> => {
  const created = await executeActivityCommand(
    null,
    { type: 'CreateActivity', activity },
    { correlationId: 'correlation-1' },
    { eventStore, projectionStore }
  );
  assert.equal(created?.name, 'Initial name');
  assert.equal(commits[0].revision, 1);
  assert.equal(commits[0].events[0].type, 'ActivityCreated');
  assert.equal(typeof commits[0].command.id, 'string');

  const updated = await executeActivityCommand(
    created,
    { type: 'UpdateActivity', activity: { ...activity, name: 'Updated name' } },
    { correlationId: 'correlation-2' },
    { eventStore, projectionStore }
  );
  assert.equal(updated?.name, 'Updated name');
  assert.equal(commits[1].revision, 2);
  assert.equal(commits[1].events[0].type, 'ActivityDetailsChanged');
  assert.equal(projections.length, 2);

  const replayed = await executeActivityCommand(
    created,
    { type: 'UpdateActivity', activity: { ...activity, name: 'Updated name' } },
    { idempotencyKey: 'retry-1' },
    { eventStore, projectionStore }
  );
  assert.equal(replayed?.name, 'Updated name');
  const commitCount = commits.length;
  const replayedRetry = await executeActivityCommand(
    updated,
    { type: 'UpdateActivity', activity: { ...activity, name: 'Updated name' } },
    { idempotencyKey: 'retry-1' },
    { eventStore, projectionStore }
  );
  assert.equal(replayedRetry?.name, 'Updated name');
  assert.equal(commits.length, commitCount);

  await assert.rejects(
    () => executeActivityCommand(
      updated,
      { type: 'UpdateActivity', activity: { ...activity, name: 'Different retry' } },
      { idempotencyKey: 'retry-1' },
      { eventStore, projectionStore }
    ),
    ActivityIdempotencyConflictError
  );

  await assert.rejects(
    () => executeActivityCommand(
      updated,
      { type: 'UpdateActivity', activity: { ...activity, name: 'Concurrent update' } },
      { expectedRevision: 0 },
      { eventStore, projectionStore }
    ),
    ActivityRevisionConflictError
  );
  console.log('Activity command service tests passed');
};

void main();
