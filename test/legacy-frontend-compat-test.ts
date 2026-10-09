import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { dataStore } from '../src/data/store';
import { mongoConnection } from '../src/database/connection';
import groupRoutes from '../src/routes/groupRoutes';
import { activityToEventDocument, eventDocumentToActivity } from '../src/types/mappers';
import type { Activity, EventDocument } from '../src/types';

const withPatches = async <T>(
  patches: Partial<typeof dataStore>,
  run: () => Promise<T>
): Promise<T> => {
  const originals = Object.entries(patches).map(([key]) => [key, (dataStore as any)[key]] as const);
  try {
    for (const [key, value] of Object.entries(patches)) (dataStore as any)[key] = value;
    return await run();
  } finally {
    for (const [key, value] of originals) (dataStore as any)[key] = value;
  }
};

const makeDocument = (activity: Activity): EventDocument => ({
  _id: activity.id,
  ...activityToEventDocument(activity),
  createdAt: new Date(),
  updatedAt: new Date()
});

const request = async (
  baseUrl: string,
  path: string,
  token: string,
  init?: RequestInit
): Promise<Response> => fetch(`${baseUrl}${path}`, {
  ...init,
  headers: {
    authorization: `Bearer ${token}`,
    ...(init?.headers ?? {})
  }
});

const run = async (): Promise<void> => {
  const originalSecret = process.env.JWT_SECRET;
  const originalGetCollection = (mongoConnection as any).getEventsCollection;
  const originalGetDb = (mongoConnection as any).getDb;
  const docs: EventDocument[] = [
    makeDocument({
      id: 'legacy-1',
      squadId: 'squad-1',
      kind: 'match',
      name: 'Existing legacy game',
      startsAt: '2026-10-09T18:00:00.000Z',
      matchFormatId: 'format-1',
      minPlayersPerTeam: 1,
      maxPlayersPerTeam: 11,
      teams: [{
        id: 'legacy-team',
        name: 'First',
        strength: 2,
        startTime: '18:00',
        selectedPlayers: ['player-1'],
        lineup: [{ periodNumber: 1, assignments: [{ slotId: 'slot-1', playerId: 'player-1' }] }]
      }],
      invitations: [{ id: 'invite-1', playerId: 'player-1', response: 'open' }],
      attendance: [{ personId: 'adult-1', status: 'present' }],
      tasks: [{
        id: 'task-1',
        name: 'Bring cones',
        requiredPeople: 1,
        signups: [{ personId: 'adult-1' }],
        isFulfilled: true
      }]
    }),
    makeDocument({
      id: 'training-1',
      squadId: 'squad-1',
      kind: 'training',
      name: 'Training',
      startsAt: '2026-10-10T18:00:00.000Z',
      trainerIds: ['trainer-1'],
      teams: [],
      invitations: []
    }),
    makeDocument({
      id: 'social-1',
      squadId: 'squad-1',
      kind: 'social',
      name: 'Social',
      startsAt: '2026-10-11T18:00:00.000Z',
      teams: [],
      invitations: []
    })
  ];
  const counters = new Map<string, number>();
  const collection = {
    find: (filter: Record<string, unknown>) => ({
      sort: () => ({
        toArray: async () => docs.filter(doc =>
          (!filter.groupId || doc.groupId === filter.groupId) &&
          (!filter.kind || !(filter.kind as { $nin: string[] }).$nin?.includes(doc.kind ?? ''))
        )
      })
    }),
    findOne: async (filter: { _id: string; groupId?: string }) =>
      docs.find(doc => doc._id === filter._id && (!filter.groupId || doc.groupId === filter.groupId)) ?? null,
    insertOne: async (document: EventDocument) => {
      docs.push(document);
      return { acknowledged: true };
    },
    findOneAndUpdate: async (
      filter: { _id: string },
      update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
    ) => {
      const document = docs.find(doc => doc._id === filter._id);
      if (!document) return null;
      Object.assign(document, update.$set);
      for (const key of Object.keys(update.$unset ?? {})) {
        delete (document as unknown as Record<string, unknown>)[key];
      }
      return document;
    },
    deleteOne: async (filter: { _id: string; kind?: { $nin: string[] } }) => {
      const index = docs.findIndex(doc =>
        doc._id === filter._id &&
        (!filter.kind || !filter.kind.$nin.includes(doc.kind ?? ''))
      );
      if (index < 0) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    }
  };

  process.env.JWT_SECRET = 'legacy-frontend-contract-test-secret';
  (mongoConnection as any).getEventsCollection = () => collection;
  (mongoConnection as any).getDb = () => ({
    collection: () => ({
      findOneAndUpdate: async (filter: { _id: string }) => {
        const next = (counters.get(filter._id) ?? 0) + 1;
        counters.set(filter._id, next);
        return { sequence_value: next };
      }
    })
  });

  const app = express();
  app.use(express.json());
  app.use('/api/groups', groupRoutes);
  app.use('/api/squads', groupRoutes);
  const server = createServer(app);

  try {
    await withPatches({
      getUserGroupAccess: async (_userId, groupId) => ({
        memberId: 'admin-member',
        roles: ['admin', 'trainer']
      })
    }, async () => {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert(address && typeof address !== 'string');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const token = jwt.sign({ id: 'admin-user', email: 'admin@example.test' }, process.env.JWT_SECRET!);

      const listedResponse = await request(baseUrl, '/api/groups/squad-1/events', token);
      assert.equal(listedResponse.status, 200);
      const listed = await listedResponse.json() as Array<Record<string, unknown>>;
      assert.deepEqual(listed.map(event => event.id), ['legacy-1']);
      assert.equal(listed[0].playingModeId, 'format-1');
      assert.equal('matchFormatId' in listed[0], false);
      assert.equal('attendance' in listed[0], false);
      assert.equal('tasks' in listed[0], false);

      const detailResponse = await request(baseUrl, '/api/groups/squad-1/events/legacy-1', token);
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json() as Record<string, unknown>;
      assert.equal(detail.name, 'Existing legacy game');
      assert.equal('kind' in detail, false);
      assert.equal('startsAt' in detail, false);

      const createResponse = await request(baseUrl, '/api/groups/squad-1/events', token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Created by old frontend',
          date: '2026-10-12',
          minPlayersPerTeam: 1,
          maxPlayersPerTeam: 11,
          playingModeId: 'format-1',
          teams: [{
            id: 'created-team',
            name: 'Home',
            strength: 2,
            startTime: '19:00',
            selectedPlayers: [],
            lineup: [{ periodNumber: 1, assignments: [] }]
          }],
          invitations: [{ id: 'created-invite', playerId: 'player-2', status: 'open' }]
        })
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json() as Record<string, unknown>;
      assert.equal(created.playingModeId, 'format-1');
      const createdId = String(created.id);
      const stored = docs.find(doc => doc._id === createdId)!;
      assert.equal(stored.kind, 'match');
      assert.equal(stored.matchFormatId, 'format-1');
      assert.equal(stored.playingModeId, 'format-1');
      assert(stored.startsAt instanceof Date);

      const updateResponse = await request(baseUrl, `/api/groups/squad-1/events/${createdId}`, token, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playingModeId: 'format-2' })
      });
      assert.equal(updateResponse.status, 200);
      const updated = await updateResponse.json() as Record<string, unknown>;
      assert.equal(updated.playingModeId, 'format-2');
      assert.equal(stored.matchFormatId, 'format-2');

      const invitationResponse = await request(
        baseUrl,
        `/api/groups/squad-1/events/${createdId}/players/player-2/status`,
        token,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'accepted' })
        }
      );
      assert.equal(invitationResponse.status, 200);
      assert.equal(stored.invitations[0].status, 'accepted');
      assert.equal(stored.invitations[0].response, 'accepted');

      const selectionResponse = await request(baseUrl, `/api/groups/squad-1/events/${createdId}/selection`, token, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          teams: [{
            id: 'created-team',
            name: 'Home',
            strength: 2,
            startTime: '19:00',
            selectedPlayers: ['player-2'],
            lineup: [{ periodNumber: 1, assignments: [{ slotId: 'slot-1', playerId: 'player-2' }] }]
          }]
        })
      });
      assert.equal(selectionResponse.status, 200);
      assert.deepEqual(stored.teams[0].selectedPlayers, ['player-2']);
      assert.equal(stored.teams[0].lineup?.[0].assignments[0].playerId, 'player-2');
      const activityView = eventDocumentToActivity(stored);
      assert.equal(activityView.kind, 'match');
      assert.equal(activityView.matchFormatId, 'format-2');
      assert.deepEqual(activityView.teams[0].selectedPlayers, ['player-2']);
      assert.equal(activityView.tasks, undefined);
      assert.equal(activityView.attendance, undefined);
    });

    console.log('Legacy frontend HTTP compatibility tests passed.');
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
    (mongoConnection as any).getEventsCollection = originalGetCollection;
    (mongoConnection as any).getDb = originalGetDb;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
};

void run().catch(error => {
  console.error('Legacy frontend HTTP compatibility tests failed:', error);
  process.exitCode = 1;
});
