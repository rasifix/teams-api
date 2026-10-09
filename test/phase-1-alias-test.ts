import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { dataStore } from '../src/data/store';
import groupRoutes from '../src/routes/groupRoutes';
import { personDocumentToPlayer, playerToPersonDocument } from '../src/types/mappers';

const mode = {
  id: 'format-1',
  name: '4x20',
  numberOfPeriods: 4,
  periodLengthMinutes: 20,
  minimumPeriodsPerPlayer: 2,
  isDefault: true
};

const group = {
  id: 'group-1',
  name: 'Fixture squad',
  playingModes: [mode]
};

const withPatchedDataStore = async <T>(
  patches: Partial<typeof dataStore>,
  run: () => Promise<T>
): Promise<T> => {
  const originals = Object.entries(patches).map(([key]) => [key, (dataStore as any)[key]] as const);

  try {
    for (const [key, value] of Object.entries(patches)) {
      (dataStore as any)[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of originals) {
      (dataStore as any)[key] = value;
    }
  }
};

const request = async (baseUrl: string, path: string, token: string, init?: RequestInit): Promise<Response> => {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
};

const run = async (): Promise<void> => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'phase-1-test-secret';
  let accessedGroupId: string | undefined;
  let savedMatchFormatId: string | null | undefined;
  const app = express();
  app.use(express.json());
  app.use('/api/groups', groupRoutes);
  app.use('/api/squads', groupRoutes);

  const server = createServer(app);

  try {
    await withPatchedDataStore(
      {
        getUserById: async id => ({ id, email: `${id}@example.com`, password: 'hash' }),
        getUserByEmail: async () => undefined,
        getAllGroups: async () => [group],
        getGroupById: async () => group,
        getUserGroupAccess: async (userId, groupId) => {
          accessedGroupId = groupId;
          return {
            memberId: `${userId}-member`,
            roles: userId === 'guardian' ? ['guardian'] : ['admin', 'trainer']
          };
        },
        getGroupPeriods: async groupId => {
          accessedGroupId = groupId;
          return [{ id: 'period-1', name: 'Autumn', startDate: '2026-09-01', endDate: '2026-12-31' }];
        },
        getGroupPlayingModes: async groupId => {
          accessedGroupId = groupId;
          return [mode];
        },
        getAllPlayers: async () => [{
          id: 'player-1',
          groupId: 'group-1',
          roles: ['player'],
          firstName: 'Player',
          lastName: 'One',
          birthDate: '2014-06-23',
          level: 2
        }],
        getAllTrainers: async () => [],
        getAllShirtSets: async () => [],
        updateEvent: async (_id, updates) => {
          savedMatchFormatId = updates.playingModeId;
          return {
            id: 'event-1',
            groupId: 'group-1',
            name: 'Fixture',
            date: '2026-10-10',
            minPlayersPerTeam: 1,
            maxPlayersPerTeam: 7,
            teams: [],
            invitations: [],
            playingModeId: updates.playingModeId,
            matchFormatId: updates.playingModeId
          };
        }
      },
      async () => {
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        assert(address && typeof address !== 'string');
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const adminToken = jwt.sign({ id: 'admin', email: 'admin@example.com' }, process.env.JWT_SECRET!);
        const guardianToken = jwt.sign({ id: 'guardian', email: 'guardian@example.com' }, process.env.JWT_SECRET!);

        const legacySquadResponse = await request(baseUrl, '/api/groups/group-1', adminToken);
        const squadResponse = await request(baseUrl, '/api/squads/group-1', adminToken);
        assert.equal(legacySquadResponse.status, 200);
        assert.equal(squadResponse.status, 200);
        const legacySquad = await legacySquadResponse.json() as Record<string, unknown>;
        const squad = await squadResponse.json() as Record<string, unknown>;
        assert.equal(squad.id, legacySquad.id);
        assert.equal(squad.name, legacySquad.name);
        assert.deepEqual(squad.matchFormats, squad.playingModes);
        assert.equal('matchFormats' in legacySquad, false);

        const groupsListResponse = await request(baseUrl, '/api/groups', adminToken);
        const squadsListResponse = await request(baseUrl, '/api/squads', adminToken);
        assert.equal(groupsListResponse.status, 200);
        const legacyGroups = await groupsListResponse.json() as Array<Record<string, unknown>>;
        const squads = await squadsListResponse.json() as Array<Record<string, unknown>>;
        assert.equal(squads[0].id, legacyGroups[0].id);
        assert.equal(squads[0].name, legacyGroups[0].name);
        assert.deepEqual(squads[0].matchFormats, squads[0].playingModes);
        assert.equal('matchFormats' in legacyGroups[0], false);

        const legacyPeriodsResponse = await request(baseUrl, '/api/groups/group-1/periods', adminToken);
        const squadPeriodsResponse = await request(baseUrl, '/api/squads/group-1/periods', adminToken);
        assert.equal(legacyPeriodsResponse.status, 200);
        assert.deepEqual(await squadPeriodsResponse.json(), await legacyPeriodsResponse.json());
        assert.equal(accessedGroupId, 'group-1');

        const playingModesResponse = await request(baseUrl, '/api/squads/group-1/playing-modes', adminToken);
        const matchFormatsResponse = await request(baseUrl, '/api/squads/group-1/match-formats', adminToken);
        assert.deepEqual(await matchFormatsResponse.json(), await playingModesResponse.json());

        const membersDenied = await request(baseUrl, '/api/groups/group-1/shirtsets', guardianToken);
        const squadMembersDenied = await request(baseUrl, '/api/squads/group-1/shirtsets', guardianToken);
        assert.equal(membersDenied.status, 403);
        assert.equal(squadMembersDenied.status, membersDenied.status);
        assert.deepEqual(await squadMembersDenied.json(), await membersDenied.json());

        const legacyMembersResponse = await request(baseUrl, '/api/groups/group-1/members', guardianToken);
        const squadMembersResponse = await request(baseUrl, '/api/squads/group-1/members', guardianToken);
        assert.equal(legacyMembersResponse.status, 200);
        assert.equal(squadMembersResponse.status, legacyMembersResponse.status);
        assert.deepEqual(await squadMembersResponse.json(), await legacyMembersResponse.json());

        const updateResponse = await request(baseUrl, '/api/squads/group-1/events/event-1', adminToken, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ matchFormatId: 'format-2' })
        });
        assert.equal(updateResponse.status, 200);
        assert.equal(savedMatchFormatId, 'format-2');
        const updatedEvent = await updateResponse.json() as { playingModeId: string; matchFormatId: string };
        assert.equal(updatedEvent.playingModeId, 'format-2');
        assert.equal(updatedEvent.matchFormatId, 'format-2');
      }
    );

    const player = personDocumentToPlayer({
      _id: 'player-1',
      groupId: 'group-1',
      roles: ['player'],
      firstName: 'Player',
      lastName: 'One',
      birthDate: '2014-06-23',
      level: 2,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    assert.equal(player?.birthDate, '2014-06-23');
    assert.equal(player?.birthYear, 2014);
    const playerDocument = playerToPersonDocument({
      id: 'player-1',
      groupId: 'group-1',
      roles: ['player'],
      firstName: 'Player',
      lastName: 'One',
      birthDate: '2014-06-23',
      birthYear: 2014,
      level: 2
    });
    assert.equal(playerDocument.birthDate, '2014-06-23');
    assert.equal('birthYear' in playerDocument, false);

    console.log('Phase 1 alias and compatibility tests passed.');
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
};

void run().catch(error => {
  console.error('Phase 1 alias and compatibility tests failed:', error);
  process.exitCode = 1;
});
