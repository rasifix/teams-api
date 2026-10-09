import {
  getAllGroups,
  getGroupById
} from '../src/controllers/groupController';
import { getAllMembers } from '../src/controllers/membersController';
import { getAllEvents } from '../src/controllers/eventController';
import { getShirtSets } from '../src/controllers/shirtSetController';
import { getPeriods } from '../src/controllers/periodController';
import { getFormations } from '../src/controllers/formationController';
import { getPlayingModes } from '../src/controllers/playingModeController';
import { importLocalStorageData } from '../src/controllers/importController';
import { dataStore } from '../src/data/store';
import { AuthRequest } from '../src/middleware/auth';
import {
  arraySchema,
  assertSchema,
  eventSchema,
  formationSchema,
  groupSchema,
  numberSchema,
  objectSchema,
  periodSchema,
  playingModeSchema,
  shirtSetSchema,
  stringSchema
} from './schemaAssertions';

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload?: unknown) => MockResponse;
};

const createMockResponse = (): MockResponse => {
  const response: MockResponse = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };

  return response;
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

const assertStatus = (response: MockResponse, expected: number, endpoint: string): void => {
  if (response.statusCode !== expected) {
    throw new Error(`${endpoint} returned ${response.statusCode}; expected ${expected}`);
  }
};

const fixtureEvent = {
  id: 'event-1',
  groupId: 'group-1',
  name: 'Fixture match',
  date: '2026-10-10',
  maxPlayersPerTeam: 7,
  minPlayersPerTeam: 5,
  teams: [{
    id: 'team-1',
    name: 'Team A',
    strength: 2,
    startTime: '10:00',
    selectedPlayers: ['player-1']
  }],
  invitations: [{
    id: 'invitation-1',
    playerId: 'player-1',
    status: 'accepted' as const
  }]
};

const testReadEndpointSchemas = async (): Promise<void> => {
  await withPatchedDataStore(
    {
      getUserById: async () => ({ id: 'user-1', email: 'user@example.com', password: 'hash' }),
      getAllGroups: async () => [{ id: 'group-1', name: 'Fixture group' }],
      getUserGroupAccess: async () => ({ memberId: 'member-1', roles: ['trainer'] }),
      getGroupById: async () => ({ id: 'group-1', name: 'Fixture group' }),
      getAllPlayers: async () => [{
        id: 'player-1',
        groupId: 'group-1',
        roles: ['player'],
        firstName: 'Player',
        lastName: 'One',
        birthDate: '2014-01-01',
        level: 2
      }],
      getAllTrainers: async () => [],
      getAllEvents: async () => [fixtureEvent],
      getAllShirtSets: async () => [{
        id: 'shirt-set-1',
        groupId: 'group-1',
        sponsor: 'Fixture',
        color: 'Red',
        shirts: [{ number: 1, size: 'M', isGoalkeeper: false }]
      }],
      getGroupPeriods: async () => [{
        id: 'period-1',
        name: 'Autumn',
        startDate: '2026-09-01',
        endDate: '2026-12-31'
      }],
      getGroupFormations: async () => [{
        id: 'formation-1',
        name: 'Basic',
        slots: [{ id: 'slot-1', positionCode: 'GK' }, { id: 'slot-2', positionCode: 'ST' }]
      }],
      getGroupPlayingModes: async () => [{
        id: 'mode-1',
        name: '4x20',
        numberOfPeriods: 4,
        periodLengthMinutes: 20,
        minimumPeriodsPerPlayer: 2,
        isDefault: true
      }]
    },
    async () => {
      const groupsResponse = createMockResponse();
      await getAllGroups({ user: { id: 'user-1' } } as AuthRequest, groupsResponse as any);
      assertStatus(groupsResponse, 200, 'GET /api/groups');
      assertSchema(arraySchema(groupSchema), groupsResponse.body, 'groups');

      const groupResponse = createMockResponse();
      await getGroupById({ params: { id: 'group-1' } } as any, groupResponse as any);
      assertStatus(groupResponse, 200, 'GET /api/groups/:id');
      assertSchema(groupSchema, groupResponse.body, 'group');

      const membersResponse = createMockResponse();
      await getAllMembers({ params: { groupId: 'group-1' }, query: {}, groupAccess: { roles: ['trainer'] } } as any, membersResponse as any);
      assertStatus(membersResponse, 200, 'GET /api/groups/:groupId/members');
      assertSchema(objectSchema({
        players: arraySchema(objectSchema({ id: stringSchema, groupId: stringSchema, roles: arraySchema(stringSchema) })),
        trainers: arraySchema(objectSchema({ id: stringSchema, groupId: stringSchema, roles: arraySchema(stringSchema) }))
      }), membersResponse.body, 'members');

      const eventsResponse = createMockResponse();
      await getAllEvents({ params: { groupId: 'group-1' }, groupAccess: { roles: ['trainer'] } } as any, eventsResponse as any);
      assertStatus(eventsResponse, 200, 'GET /api/groups/:groupId/events');
      assertSchema(arraySchema(eventSchema), eventsResponse.body, 'events');

      const shirtSetsResponse = createMockResponse();
      await getShirtSets({ params: { groupId: 'group-1' } } as any, shirtSetsResponse as any);
      assertStatus(shirtSetsResponse, 200, 'GET /api/groups/:groupId/shirtsets');
      assertSchema(arraySchema(shirtSetSchema), shirtSetsResponse.body, 'shirtSets');

      const periodsResponse = createMockResponse();
      await getPeriods({ params: { groupId: 'group-1' } } as any, periodsResponse as any);
      assertStatus(periodsResponse, 200, 'GET /api/groups/:groupId/periods');
      assertSchema(arraySchema(periodSchema), periodsResponse.body, 'periods');

      const formationsResponse = createMockResponse();
      await getFormations({ params: { groupId: 'group-1' } } as any, formationsResponse as any);
      assertStatus(formationsResponse, 200, 'GET /api/groups/:groupId/formations');
      assertSchema(arraySchema(formationSchema), formationsResponse.body, 'formations');

      const playingModesResponse = createMockResponse();
      await getPlayingModes({ params: { groupId: 'group-1' } } as any, playingModesResponse as any);
      assertStatus(playingModesResponse, 200, 'GET /api/groups/:groupId/playing-modes');
      assertSchema(arraySchema(playingModeSchema), playingModesResponse.body, 'playingModes');
    }
  );
};

const testImportSummarySchema = async (): Promise<void> => {
  await withPatchedDataStore(
    {
      getGroupById: async () => ({ id: 'group-1', name: 'Fixture group' })
    },
    async () => {
      const response = createMockResponse();
      await importLocalStorageData(
        { params: { groupId: 'group-1' }, body: {} } as any,
        response as any
      );
      assertStatus(response, 200, 'POST /api/groups/:groupId/import');
      assertSchema(objectSchema({
        message: stringSchema,
        summary: objectSchema({
          playersImported: numberSchema,
          trainersImported: numberSchema,
          eventsImported: numberSchema,
          shirtSetsImported: numberSchema,
          errors: arraySchema(stringSchema)
        }),
        groupId: stringSchema
      }), response.body, 'import response');
    }
  );
};

const tests: Array<{ name: string; run: () => Promise<void> }> = [
  { name: 'read endpoint response schemas', run: testReadEndpointSchemas },
  { name: 'import summary schema', run: testImportSummarySchema }
];

const run = async (): Promise<void> => {
  for (const testCase of tests) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      console.error(`FAIL ${testCase.name}:`, error);
      process.exitCode = 1;
      return;
    }
  }

  console.log('Phase 0 schema assertions passed.');
};

void run();
