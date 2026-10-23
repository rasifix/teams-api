import assert from 'node:assert/strict';
import { createActivity } from '../src/controllers/activityController';
import { dataStore } from '../src/data/store';
import { mongoConnection } from '../src/database/connection';

const response = () => ({
  statusCode: 200,
  body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  setHeader() { return this; },
  json(payload: unknown) { this.body = payload; return this; }
});

const main = async (): Promise<void> => {
  const originalCreate = dataStore.createActivity;
  const originalRevision = dataStore.getActivityRevision;
  const originalGetDb = (mongoConnection as any).getDb;
  const createdIds: string[] = [];
  try {
    (dataStore as any).createActivity = async (activity: { id: string }) => {
      createdIds.push(activity.id);
      return activity;
    };
    (dataStore as any).getActivityRevision = async () => 1;
    let sequence = 0;
    (mongoConnection as any).getDb = () => ({
      collection: () => ({
        findOneAndUpdate: async () => ({ sequence_value: ++sequence })
      })
    });

    const request = {
      params: { groupId: 'squad-1' },
      headers: { 'idempotency-key': 'create-retry-1' },
      header(name: string) { return this.headers[name.toLocaleLowerCase() as 'idempotency-key']; },
      body: {
        kind: 'match',
        name: 'Retry-safe match',
        startsAt: '2026-10-10T12:30:00.000Z',
        minPlayersPerTeam: 1,
        maxPlayersPerTeam: 11,
        invitations: [],
        teams: [{ id: 'team-1', name: 'Blue', selectedPlayers: [] }]
      }
    } as any;

    const first = response();
    await createActivity(request, first as any);
    const second = response();
    await createActivity(request, second as any);
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(createdIds.length, 2);
    assert.notEqual(createdIds[0], createdIds[1], 'Activity IDs remain server-generated and are not derived from the idempotency key');
    console.log('Activity controller idempotency tests passed');
  } finally {
    (dataStore as any).createActivity = originalCreate;
    (dataStore as any).getActivityRevision = originalRevision;
    (mongoConnection as any).getDb = originalGetDb;
  }
};

void main();
