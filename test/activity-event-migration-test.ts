import assert from 'node:assert/strict';
import type { ActivityEvent } from '../src/types/activityEvents';
import { migrateActivityProjections } from '../src/migrations/activityEventMigration';
import type { Activity } from '../src/types';
import type { EventDocument } from '../src/types/mongodb';

const activity: Activity = {
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Baseline match',
  startsAt: '2026-11-04T18:00:00.000Z',
  teams: [],
  invitations: []
};

const document: EventDocument = {
  _id: activity.id,
  groupId: activity.squadId,
  kind: activity.kind,
  status: activity.status,
  name: activity.name,
  startsAt: new Date(activity.startsAt),
  teams: [],
  invitations: [],
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
  legacyMarker: 'must-remain'
} as EventDocument;

const commits: ActivityEvent[] = [];
const metadata: Record<string, unknown> = {};
const projections = {
  find: () => ({ toArray: async () => [document] })
} as any;
const eventStore = {
  getStream: async () => commits,
  append: async (commit: ActivityEvent) => {
    commits.push(commit);
    return commit;
  }
} as any;
const projectionStore = {
  markProjected: async (_squadId: string, _activityId: string, value: unknown) => {
    Object.assign(metadata, value);
    return { applied: true, document };
  }
} as any;

const main = async (): Promise<void> => {
  const first = await migrateActivityProjections({ projections, eventStore, projectionStore });
  assert.equal(first.scanned, 1);
  assert.equal(first.imported, 1);
  assert.equal(first.verified, 1);
  assert.deepEqual(first.mismatches, []);
  assert.equal(commits[0].events[0].type, 'ActivityImported');
  assert.equal(metadata.projectedRevision, 1);
  assert.equal((document as any).legacyMarker, 'must-remain');

  const second = await migrateActivityProjections({ projections, eventStore, projectionStore });
  assert.equal(second.imported, 0);
  assert.equal(second.alreadyMigrated, 1);
  assert.equal(commits.length, 1);
  console.log('Activity event migration tests passed');
};

void main();
