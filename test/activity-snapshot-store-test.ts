import assert from 'node:assert/strict';
import type { Collection } from 'mongodb';
import { ActivitySnapshotStore } from '../src/data/activitySnapshotStore';
import type { ActivitySnapshotDocument } from '../src/types/mongodb';

const documents: ActivitySnapshotDocument[] = [];
const collection = {
  findOne: async (filter: { streamId?: string; squadId?: string; aggregateId?: string }) =>
    documents.find(document =>
      (!filter.streamId || document.streamId === filter.streamId) &&
      (!filter.squadId || document.squadId === filter.squadId) &&
      (!filter.aggregateId || document.aggregateId === filter.aggregateId)
    ) ?? null,
  insertOne: async (document: ActivitySnapshotDocument) => {
    documents.push(document);
    return {};
  },
  replaceOne: async (_filter: unknown, document: ActivitySnapshotDocument) => {
    const index = documents.findIndex(item => item.streamId === document.streamId);
    if (index >= 0) documents[index] = document;
    return {};
  }
} as unknown as Collection<ActivitySnapshotDocument>;

const main = async (): Promise<void> => {
  const store = new ActivitySnapshotStore(collection);
  const snapshot = {
    streamId: 'activity:squad-1:activity-1',
    aggregateId: 'activity-1',
    squadId: 'squad-1',
    revision: 100,
    commitId: 'commit-100',
    schemaVersion: 1,
    deleted: false,
    activity: null
  };
  assert.equal(await store.save(snapshot), true);
  assert.equal(await store.save({ ...snapshot, revision: 99, commitId: 'commit-99' }), false);
  assert.equal((await store.getLatest({ squadId: 'squad-1', activityId: 'activity-1' }))?.revision, 100);
  console.log('Activity snapshot store tests passed');
};

void main();
