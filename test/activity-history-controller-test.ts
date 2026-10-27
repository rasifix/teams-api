import assert from 'node:assert/strict';
import { getActivityHistory } from '../src/controllers/activityEventController';
import { activityEventStore } from '../src/data/activityEventStore';
import { mongoConnection } from '../src/database/connection';
import { decideActivityCommand } from '../src/domain/activityCommands';
import type { Activity } from '../src/types';
import type { ActivityEvent } from '../src/types/activityEvents';

const activity: Activity = {
  id: 'a', squadId: 's', kind: 'match', status: 'active', name: 'Match', startsAt: '2020-01-01T10:00:00.000Z',
  teams: [{ id: 't', name: 'Red', strength: 2, selectedPlayers: [] }], invitations: []
};
const commit = (revision: number, events: ActivityEvent['events']): ActivityEvent => ({
  _id: `c${revision}`, streamId: 'activity:squad-s:activity-a', aggregateType: 'activity', aggregateId: 'a', squadId: 's', revision,
  command: { type: 'Test', idempotencyKey: null, requestHash: 'h' }, actor: { type: 'user', memberId: 'm' },
  recordedAt: '2020-01-01T11:00:00.000Z', correlationId: 'c', events
});
const commits = [commit(1, decideActivityCommand(null, { type: 'CreateActivity', activity })), commit(2, decideActivityCommand(activity, { type: 'DeleteActivity' }))];
const response = () => ({
  statusCode: 200, body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  json(value: unknown) { this.body = value; return this; }
});

const main = async (): Promise<void> => {
  const originalStream = activityEventStore.getStream;
  const originalMembers = mongoConnection.getMembersCollection;
  try {
    (activityEventStore as any).getStream = async () => commits;
    (mongoConnection as any).getMembersCollection = () => ({ find: () => ({ toArray: async () => [{ _id: 'm', firstName: 'Alex', lastName: 'Coach' }] }) });
    const res = response();
    await getActivityHistory({ params: { groupId: 's', id: 'a' } } as any, res as any);
    assert.equal(res.statusCode, 200);
    const page = res.body as { items: Array<{ revision: number; actor: { displayName: string }; changes: Array<{ type: string }> }> };
    assert.deepEqual(page.items.map(item => item.revision), [2, 1]);
    assert.equal(page.items[0].actor.displayName, 'Alex Coach');
    assert.equal(page.items[0].changes[0].type, 'activity.deleted');
    (activityEventStore as any).getStream = async () => [];
    const missing = response();
    await getActivityHistory({ params: { groupId: 's', id: 'missing' } } as any, missing as any);
    assert.equal(missing.statusCode, 404);
    console.log('Activity history controller tests passed');
  } finally {
    (activityEventStore as any).getStream = originalStream;
    (mongoConnection as any).getMembersCollection = originalMembers;
  }
};
void main();
