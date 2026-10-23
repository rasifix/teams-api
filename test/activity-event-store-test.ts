import assert from 'node:assert/strict';
import type { Collection } from 'mongodb';
import { ActivityEventStore } from '../src/data/activityEventStore';
import type { ActivityEventDocument } from '../src/types/mongodb';

const event = (revision: number): ActivityEventDocument => ({
  _id: `event-${revision}`,
  streamId: 'activity:squad-1:activity-1',
  aggregateType: 'activity',
  aggregateId: 'activity-1',
  squadId: 'squad-1',
  revision,
  command: {
    type: 'TestCommand',
    idempotencyKey: null,
    requestHash: 'sha256:test'
  },
  actor: { type: 'system' },
  recordedAt: new Date(`2026-01-01T00:0${revision}:00.000Z`),
  correlationId: `correlation-${revision}`,
  events: [{
    ordinal: 0,
    type: 'ActivityImported',
    schemaVersion: 1,
    data: { revision }
  }]
});

const documents: ActivityEventDocument[] = [];
const collection = {
  distinct: async (_field: string, filter: { squadId: string }) =>
    [...new Set(documents.filter(document => document.squadId === filter.squadId).map(document => document.aggregateId))],
  insertOne: async (document: ActivityEventDocument) => {
    documents.push(document);
    return {};
  },
  find: () => ({
    sort: (sort: { revision: 1 | -1 }) => ({
      toArray: async () => [...documents].sort((left, right) =>
        sort.revision === 1 ? left.revision - right.revision : right.revision - left.revision
      ),
      limit: () => ({
        next: async () => [...documents].sort((left, right) => right.revision - left.revision)[0] ?? null
      })
    })
  })
} as unknown as Collection<ActivityEventDocument>;

const store = new ActivityEventStore(collection);

const main = async (): Promise<void> => {
  const appended = await store.append({
    _id: 'event-1',
    streamId: 'activity:squad-1:activity-1',
    aggregateType: 'activity',
    aggregateId: 'activity-1',
    squadId: 'squad-1',
    revision: 1,
    command: { type: 'TestCommand', idempotencyKey: null, requestHash: 'sha256:test' },
    actor: { type: 'system' },
    correlationId: 'correlation-1',
    events: [{ ordinal: 0, type: 'ActivityImported', schemaVersion: 1, data: {} }]
  });

  assert.equal(appended.revision, 1);
  assert.match(appended.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert(documents[0].recordedAt instanceof Date, 'Mongo document must store recordedAt as Date');

  documents.push(event(2));
  const stream = await store.getStream({ squadId: 'squad-1', activityId: 'activity-1' });
  assert.deepEqual(stream.map(item => item.revision), [1, 2]);
  assert.deepEqual(await store.listStreams('squad-1'), [{ squadId: 'squad-1', activityId: 'activity-1' }]);
  assert.equal(await store.getLatestRevision({ squadId: 'squad-1', activityId: 'activity-1' }), 2);
  console.log('Activity event store tests passed');
};

void main();
