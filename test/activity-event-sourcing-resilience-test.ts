import assert from 'node:assert/strict';
import {
  ActivityRevisionConflictError,
  executeActivityCommand
} from '../src/domain/activityCommandService';
import { ActivityReconciler } from '../src/domain/activityReconciler';
import type { Activity } from '../src/types';
import type { ActivityEvent } from '../src/types/activityEvents';
import type { EventDocument } from '../src/types/mongodb';

const activity: Activity = {
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Resilience match',
  startsAt: '2026-11-04T18:00:00.000Z',
  teams: [],
  invitations: []
};

const commits: ActivityEvent[] = [];
let projection: EventDocument | null = null;
let failProjectionOnce = true;
const eventStore = {
  getLatestRevision: async () => commits.length,
  getByIdempotencyKey: async (squadId: string, key: string) =>
    commits.find(commit => commit.squadId === squadId && commit.command.idempotencyKey === key) ?? null,
  getStream: async () => commits,
  append: async (commit: ActivityEvent) => {
    commits.push(commit);
    return commit;
  }
} as any;
const projectionStore = {
  get: async () => projection,
  list: async () => projection ? [projection] : [],
  apply: async (next: Activity) => {
    if (failProjectionOnce) {
      failProjectionOnce = false;
      throw new Error('simulated crash after commit');
    }
    projection = {
      _id: next.id,
      groupId: next.squadId,
      kind: next.kind,
      status: next.status,
      name: next.name,
      startsAt: new Date(next.startsAt),
      teams: [],
      invitations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      projectedRevision: 1,
      projectedCommitId: commits[0]._id
    };
    return { applied: true, document: projection };
  },
  markProjected: async () => ({ applied: true, document: projection })
} as any;
const snapshotStore = { getLatest: async () => null, save: async () => true } as any;

const main = async (): Promise<void> => {
  await assert.rejects(
    () => executeActivityCommand(
      null,
      { type: 'CreateActivity', activity },
      { idempotencyKey: 'crash-retry-1' },
      { eventStore, projectionStore, snapshotStore }
    ),
    /simulated crash after commit/
  );
  assert.equal(commits.length, 1, 'the event must survive a projection failure');

  const retried = await executeActivityCommand(
    null,
    { type: 'CreateActivity', activity },
    { idempotencyKey: 'crash-retry-1' },
    { eventStore, projectionStore, snapshotStore }
  );
  assert.equal(retried?.id, activity.id);
  assert.equal(commits.length, 1, 'idempotent retry must not append a duplicate commit');

  const reconciler = new ActivityReconciler({ eventStore, projectionStore, snapshotStore });
  const repaired = await reconciler.reconcile({ squadId: activity.squadId, activityId: activity.id });
  assert.equal(repaired.repaired, true);
  assert.equal(projection?.name, activity.name);

  await assert.rejects(
    () => executeActivityCommand(
      activity,
      { type: 'UpdateActivity', activity: { ...activity, name: 'Concurrent update' } },
      { expectedRevision: 0 },
      { eventStore, projectionStore, snapshotStore }
    ),
    ActivityRevisionConflictError
  );
  console.log('Activity event-sourcing resilience tests passed');
};

void main();
