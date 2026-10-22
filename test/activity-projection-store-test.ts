import assert from 'node:assert/strict';
import type { Collection } from 'mongodb';
import { ActivityProjectionStore } from '../src/data/activityProjectionStore';
import type { Activity } from '../src/types';
import type { EventDocument } from '../src/types/mongodb';

const activity: Activity = {
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Test match',
  startsAt: '2026-11-04T18:00:00.000Z',
  teams: [],
  invitations: []
};

let document: EventDocument | undefined;
const collection = {
  findOne: async () => document ?? null,
  insertOne: async (value: EventDocument) => {
    document = value;
    return {};
  },
  findOneAndUpdate: async (
    _filter: unknown,
    update: { $set: Record<string, unknown>; $unset?: Record<string, ''> }
  ) => {
    if (!document) return null;
    document = {
      ...document,
      ...update.$set,
      ...(update.$unset ? Object.fromEntries(Object.keys(update.$unset).map(key => [key, undefined])) : {})
    } as EventDocument;
    return document;
  }
} as unknown as Collection<EventDocument>;

const main = async (): Promise<void> => {
  const store = new ActivityProjectionStore(collection);
  const first = await store.apply(activity, {
    projectedRevision: 1,
    projectedCommitId: 'commit-1'
  });
  assert.equal(first.applied, true);
  assert.equal(first.document.projectedRevision, 1);
  assert.equal(first.document.deletedAt, null);

  const stale = await store.apply({ ...activity, name: 'Stale name' }, {
    projectedRevision: 0,
    projectedCommitId: 'commit-0'
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.document.name, 'Test match');

  const newer = await store.apply({ ...activity, name: 'New name' }, {
    projectedRevision: 2,
    projectedCommitId: 'commit-2'
  });
  assert.equal(newer.applied, true);
  assert.equal(newer.document.name, 'New name');
  assert.equal(newer.document.projectedRevision, 2);
  console.log('Activity projection store tests passed');
};

void main();
