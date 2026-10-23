import assert from 'node:assert/strict';
import type { Collection } from 'mongodb';
import { ActivityEventStore } from '../src/data/activityEventStore';
import type { ActivityEventDocument } from '../src/types/mongodb';

const documents: ActivityEventDocument[] = [1, 2, 3].map(revision => ({
  _id: `commit-${revision}`,
  streamId: 'activity:squad-1:activity-1',
  aggregateType: 'activity',
  aggregateId: 'activity-1',
  squadId: 'squad-1',
  revision,
  command: { type: 'TestCommand', idempotencyKey: null, requestHash: `hash-${revision}` },
  actor: { type: 'system' },
  recordedAt: new Date(`2026-01-0${revision}T00:00:00.000Z`),
  correlationId: `correlation-${revision}`,
  events: [{ ordinal: 0, type: revision === 1 ? 'ActivityImported' : 'ActivityDetailsChanged', schemaVersion: 1, data: {} }]
}));

const collection = {
  find: (filter: any) => {
    let values = documents.filter(document => {
      if (filter.$and?.some((part: any) => part.aggregateId && part.aggregateId !== document.aggregateId)) return false;
      if (filter.$and?.some((part: any) => part['events.type'] && part['events.type'] !== document.events[0].type)) return false;
      const cursor = filter.$and?.find((part: any) => part.$or);
      if (cursor) {
        const [datePart, sameDatePart] = cursor.$or;
        const beforeDate = datePart.recordedAt.$lt;
        if (document.recordedAt >= beforeDate &&
          !(document.recordedAt.getTime() === sameDatePart.recordedAt.getTime() && document._id < sameDatePart._id)) return false;
      }
      return true;
    });
    return {
      sort: () => ({
        limit: (count: number) => ({
          toArray: async () => values
            .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime())
            .slice(0, count)
        })
      })
    };
  }
} as unknown as Collection<ActivityEventDocument>;

const main = async (): Promise<void> => {
  const store = new ActivityEventStore(collection);
  const first = await store.getSquadAuditEvents('squad-1', { limit: 2 });
  assert.deepEqual(first.items.map(item => item.revision), [3, 2]);
  assert(first.nextCursor);

  const second = await store.getSquadAuditEvents('squad-1', { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.items.map(item => item.revision), [1]);

  const filtered = await store.getSquadAuditEvents('squad-1', { eventType: 'ActivityImported' });
  assert.deepEqual(filtered.items.map(item => item.revision), [1]);

  for (let revision = 4; revision <= 1003; revision += 1) {
    documents.push({
      ...documents[0],
      _id: `commit-${revision}`,
      revision,
      recordedAt: new Date(2026, 0, 1, 0, 0, revision),
      events: [{ ordinal: 0, type: 'ActivityDetailsChanged', schemaVersion: 1, data: {} }]
    });
  }
  const largePage = await store.getSquadAuditEvents('squad-1', { limit: 100 });
  assert.equal(largePage.items.length, 100);
  assert(largePage.nextCursor, 'large audit streams must remain paginable');
  console.log('Activity audit event tests passed');
};

void main();
