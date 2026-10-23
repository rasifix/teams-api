import assert from 'node:assert/strict';
import { ActivityReconciler } from '../src/domain/activityReconciler';
import type { Activity } from '../src/types';
import type { ActivityEvent } from '../src/types/activityEvents';
import type { EventDocument } from '../src/types/mongodb';

const activity: Activity = {
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Reconciled match',
  startsAt: '2026-11-04T18:00:00.000Z',
  teams: [],
  invitations: []
};

const document: EventDocument = {
  _id: activity.id,
  groupId: activity.squadId,
  kind: activity.kind,
  status: activity.status,
  name: 'Corrupt name',
  startsAt: new Date(activity.startsAt),
  teams: [],
  invitations: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  projectedRevision: 1,
  projectedCommitId: 'old-commit'
};

const commit: ActivityEvent = {
  _id: 'commit-1',
  streamId: 'activity:squad-squad-1:activity-activity-1',
  aggregateType: 'activity',
  aggregateId: activity.id,
  squadId: activity.squadId,
  revision: 1,
  command: { type: 'CreateActivity', idempotencyKey: 'key-1', requestHash: 'hash-1' },
  actor: { type: 'system' },
  recordedAt: new Date().toISOString(),
  correlationId: 'correlation-1',
  events: [{ ordinal: 0, type: 'ActivityImported', schemaVersion: 1, data: activity }]
};

let current = document;
let applied = 0;
const projectionStore = {
  get: async () => current,
  list: async () => [current],
  apply: async (next: Activity) => {
    applied += 1;
    current = { ...current, name: next.name, projectedRevision: 1, projectedCommitId: 'commit-1' };
    return { applied: true, document: current };
  },
  markProjected: async () => ({ applied: true, document: current })
} as any;
const eventStore = { getStream: async () => [commit] } as any;

const main = async (): Promise<void> => {
  const snapshotStore = { getLatest: async () => null, save: async () => true } as any;
  const reconciler = new ActivityReconciler({ eventStore, projectionStore, snapshotStore });
  const repaired = await reconciler.reconcile({ squadId: activity.squadId, activityId: activity.id });
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.activity?.name, activity.name);
  assert.equal(repaired.differences[0].path, '$.name');
  assert.equal(applied, 1);

  const healthy = await reconciler.reconcile({ squadId: activity.squadId, activityId: activity.id });
  assert.equal(healthy.repaired, false);
  assert.equal(healthy.differences.length, 0);
  assert.equal(applied, 1);

  let snapshotProjection: EventDocument | null = { ...document, name: 'Stale snapshot projection', projectedRevision: 0 };
  const snapshotReconciler = new ActivityReconciler({
    eventStore: { getStreamAfterRevision: async () => [] } as any,
    projectionStore: {
      get: async () => snapshotProjection,
      apply: async (next: Activity) => {
        snapshotProjection = { ...snapshotProjection!, name: next.name, projectedRevision: 1, projectedCommitId: 'commit-1' };
        return { applied: true, document: snapshotProjection };
      },
      markProjected: async () => ({ applied: true, document: snapshotProjection })
    } as any,
    snapshotStore: {
      getLatest: async () => ({
        streamId: commit.streamId,
        aggregateId: activity.id,
        squadId: activity.squadId,
        revision: 1,
        commitId: 'commit-1',
        schemaVersion: 1,
        deleted: false,
        activity
      }),
      save: async () => true
    } as any
  });
  const repairedFromSnapshot = await snapshotReconciler.reconcile({ squadId: activity.squadId, activityId: activity.id });
  assert.equal(repairedFromSnapshot.repaired, true, 'a snapshot must repair a stale projection without a tail');
  assert.equal(repairedFromSnapshot.activity?.name, activity.name);

  let rebuiltProjection: EventDocument | null = null;
  const eventOnlyReconciler = new ActivityReconciler({
    eventStore: {
      listStreams: async () => [{ squadId: activity.squadId, activityId: activity.id }],
      getStream: async () => [commit],
      listSquadIds: async () => [activity.squadId]
    } as any,
    projectionStore: {
      list: async () => [],
      get: async () => null,
      apply: async (next: Activity) => {
        rebuiltProjection = { ...document, name: next.name, projectedRevision: 1, projectedCommitId: 'commit-1' };
        return { applied: true, document: rebuiltProjection };
      }
    } as any,
    snapshotStore: { getLatest: async () => null, save: async () => true } as any
  });
  const eventOnlyReport = await eventOnlyReconciler.reconcileSquad(activity.squadId);
  assert.equal(eventOnlyReport.scanned, 1, 'reconciliation must scan event-only streams');
  assert.equal(eventOnlyReport.repaired, 1, 'reconciliation must rebuild a missing projection');
  assert.equal(eventOnlyReport.failed.length, 0);
  console.log('Activity reconciler tests passed');
};

void main();
