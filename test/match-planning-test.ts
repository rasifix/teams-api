import {
  getPlayingModes,
  createPlayingMode,
  updatePlayingMode,
  deletePlayingMode,
  setDefaultPlayingMode
} from '../src/controllers/playingModeController';
import {
  getFormations,
  createFormation,
  updateFormation,
  deleteFormation
} from '../src/controllers/formationController';
import { updateEvent } from '../src/controllers/eventController';
import { dataStore } from '../src/data/store';
import { mongoConnection } from '../src/database/connection';
import type { Event, Formation, PlayingMode } from '../src/types';

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload?: unknown) => MockResponse;
};

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload?: unknown) {
      this.body = payload;
      return this;
    }
  };

  return res;
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const withPatchedDataStore = async <T>(
  patches: Partial<typeof dataStore>,
  run: () => Promise<T>
): Promise<T> => {
  const originalEntries = Object.entries(patches).map(([key]) => [key, (dataStore as any)[key]] as const);

  try {
    for (const [key, patchValue] of Object.entries(patches)) {
      (dataStore as any)[key] = patchValue;
    }

    return await run();
  } finally {
    for (const [key, originalValue] of originalEntries) {
      (dataStore as any)[key] = originalValue;
    }
  }
};

const withPatchedSequenceDb = async <T>(run: () => Promise<T>): Promise<T> => {
  const originalGetDb = (mongoConnection as any).getDb;
  const counters = new Map<string, number>();

  try {
    (mongoConnection as any).getDb = () => ({
      collection: (_name: string) => ({
        findOneAndUpdate: async (filter: { _id: string }) => {
          const current = counters.get(filter._id) ?? 0;
          const next = current + 1;
          counters.set(filter._id, next);
          return { sequence_value: next };
        }
      })
    });

    return await run();
  } finally {
    (mongoConnection as any).getDb = originalGetDb;
  }
};

const testGetPlayingModes = async (): Promise<void> => {
  const req = { params: { groupId: 'g-1' } };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      getGroupPlayingModes: async () => [
        {
          id: 'pm-1',
          name: '4x20',
          numberOfPeriods: 4,
          periodLengthMinutes: 20,
          isDefault: true
        }
      ]
    },
    async () => {
      await getPlayingModes(req as any, res as any);
    }
  );

  assert(res.statusCode === 200, 'GET playing-modes should return 200');
  const body = res.body as PlayingMode[];
  assert(Array.isArray(body) && body.length === 1, 'GET playing-modes should return one mode');
};

const testCreatePlayingMode = async (): Promise<void> => {
  const req = {
    params: { groupId: 'g-1' },
    body: {
      name: '  2x25  ',
      numberOfPeriods: 2,
      periodLengthMinutes: 25
    }
  };
  const res = createMockResponse();

  let captured: PlayingMode | undefined;

  await withPatchedDataStore(
    {
      addPlayingModeToGroup: async (_groupId: string, mode: PlayingMode) => {
        captured = mode;
        return { ...mode, isDefault: true };
      }
    },
    async () => {
      await withPatchedSequenceDb(async () => {
        await createPlayingMode(req as any, res as any);
      });
    }
  );

  assert(res.statusCode === 201, 'POST playing-modes should return 201');
  assert(captured?.name === '2x25', 'POST playing-modes should trim name');
  const body = res.body as PlayingMode;
  assert(body.isDefault === true, 'POST playing-modes should return persisted mode');
};

const testCreatePlayingModeInvalidPayload = async (): Promise<void> => {
  const req = {
    params: { groupId: 'g-1' },
    body: {
      name: 'Mode X',
      numberOfPeriods: 2,
      periodLengthMinutes: 'abc'
    }
  };
  const res = createMockResponse();

  await createPlayingMode(req as any, res as any);

  assert(res.statusCode === 400, 'POST playing-modes should return 400 for invalid payload');
  const body = res.body as { error?: string };
  assert(
    body.error === 'periodLengthMinutes must be an integer greater than or equal to 1',
    'POST playing-modes should explain invalid periodLengthMinutes'
  );
};

const testUpdatePlayingMode = async (): Promise<void> => {
  const req = {
    params: { groupId: 'g-1', playingModeId: 'pm-1' },
    body: { periodLengthMinutes: 30 }
  };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      getGroupById: async () => ({ id: 'g-1', name: 'Group 1' }),
      updatePlayingModeInGroup: async () => ({
        id: 'pm-1',
        name: '4x20',
        numberOfPeriods: 4,
        periodLengthMinutes: 30,
        isDefault: false
      })
    },
    async () => {
      await updatePlayingMode(req as any, res as any);
    }
  );

  assert(res.statusCode === 200, 'PUT playing-modes should return 200');
  const body = res.body as PlayingMode;
  assert(body.periodLengthMinutes === 30, 'PUT playing-modes should update period length');
};

const testDeletePlayingModeConflict = async (): Promise<void> => {
  const req = { params: { groupId: 'g-1', playingModeId: 'pm-1' } };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      deletePlayingModeFromGroup: async () => ({ deleted: false, reason: 'in-use' as const })
    },
    async () => {
      await deletePlayingMode(req as any, res as any);
    }
  );

  assert(res.statusCode === 409, 'DELETE playing-mode should return 409 when in use');
};

const testSetDefaultPlayingMode = async (): Promise<void> => {
  const req = { params: { groupId: 'g-1', playingModeId: 'pm-2' } };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      setDefaultPlayingModeInGroup: async () => ({
        id: 'pm-2',
        name: '3x20',
        numberOfPeriods: 3,
        periodLengthMinutes: 20,
        isDefault: true
      })
    },
    async () => {
      await setDefaultPlayingMode(req as any, res as any);
    }
  );

  assert(res.statusCode === 200, 'POST set-default should return 200');
  const body = res.body as PlayingMode;
  assert(body.isDefault === true, 'POST set-default should return mode marked default');
};

const testUpdateEventPlayingMode = async (): Promise<void> => {
  const req = {
    params: { groupId: 'g-1', id: 'event-1' },
    body: { playingModeId: 'pm-2' }
  };
  const res = createMockResponse();
  let capturedUpdates: Partial<Omit<Event, 'id'>> | undefined;

  await withPatchedDataStore(
    {
      updateEvent: async (_id: string, updates: Partial<Omit<Event, 'id'>>) => {
        capturedUpdates = updates;
        return {
          id: 'event-1',
          groupId: 'g-1',
          name: 'Match',
          date: '2026-08-26',
          maxPlayersPerTeam: 10,
          minPlayersPerTeam: 7,
          playingModeId: updates.playingModeId,
          teams: [],
          invitations: []
        };
      }
    },
    async () => {
      await updateEvent(req as any, res as any);
    }
  );

  assert(capturedUpdates?.playingModeId === 'pm-2', 'PUT event should persist playingModeId');
  assert(res.statusCode === 200, 'PUT event should return 200');
  const body = res.body as Event;
  assert(body.playingModeId === 'pm-2', 'PUT event response should include the updated playingModeId');
};

const testGetFormations = async (): Promise<void> => {
  const req = { params: { groupId: 'g-1' } };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      getGroupFormations: async () => [
        {
          id: 'f-1',
          name: '3-3',
          slots: [
            { id: 's-1', positionCode: 'GK' },
            { id: 's-2', positionCode: 'CB' }
          ]
        }
      ]
    },
    async () => {
      await getFormations(req as any, res as any);
    }
  );

  assert(res.statusCode === 200, 'GET formations should return 200');
  const body = res.body as Formation[];
  assert(Array.isArray(body) && body.length === 1, 'GET formations should return one formation');
};

const testCreateFormation = async (): Promise<void> => {
  const req = {
    params: { groupId: 'g-1' },
    body: {
      name: ' 3-2-1 ',
      slots: [{ positionCode: 'GK' }, { positionCode: 'CB' }, { positionCode: 'ST' }]
    }
  };
  const res = createMockResponse();

  let captured: Formation | undefined;

  await withPatchedDataStore(
    {
      addFormationToGroup: async (_groupId: string, formation: Formation) => {
        captured = formation;
        return formation;
      }
    },
    async () => {
      await withPatchedSequenceDb(async () => {
        await createFormation(req as any, res as any);
      });
    }
  );

  assert(res.statusCode === 201, 'POST formations should return 201');
  assert(captured?.name === '3-2-1', 'POST formations should trim name');
  assert((captured?.slots ?? []).length === 3, 'POST formations should persist slots');
  assert((captured?.slots ?? [])[0].id !== undefined, 'POST formations should assign slot ids');
};

const testCreateFormationInvalidGoalkeeperCount = async (): Promise<void> => {
  const req = {
    params: { groupId: 'g-1' },
    body: {
      name: 'No GK',
      slots: [{ positionCode: 'CB' }, { positionCode: 'ST' }]
    }
  };
  const res = createMockResponse();

  await createFormation(req as any, res as any);

  assert(res.statusCode === 400, 'POST formations should return 400 when GK count is invalid');
  const body = res.body as { error?: string };
  assert(body.error === 'exactly one slot must have positionCode GK', 'POST formations should enforce exactly one GK');
};

const testCreateFormationInvalidPositionCode = async (): Promise<void> => {
  const req = {
    params: { groupId: 'g-1' },
    body: {
      name: 'Bad Code',
      slots: [{ positionCode: 'GK' }, { positionCode: 'XYZ' }]
    }
  };
  const res = createMockResponse();

  await createFormation(req as any, res as any);

  assert(res.statusCode === 400, 'POST formations should return 400 for invalid position code');
  const body = res.body as { error?: string };
  assert(body.error === 'each slot must include a valid positionCode', 'POST formations should reject invalid positionCode');
};

const testUpdateFormation = async (): Promise<void> => {
  const req = {
    params: { groupId: 'g-1', formationId: 'f-1' },
    body: {
      name: '3-3 updated',
      slots: [
        { id: 's-1', positionCode: 'GK' },
        { id: 's-2', positionCode: 'CB' },
        { id: 's-3', positionCode: 'ST' }
      ]
    }
  };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      getGroupFormations: async () => [
        {
          id: 'f-1',
          name: '3-3',
          slots: [
            { id: 's-1', positionCode: 'GK' },
            { id: 's-2', positionCode: 'CB' },
            { id: 's-3', positionCode: 'ST' }
          ]
        }
      ],
      updateFormationInGroup: async (_groupId: string, _formationId: string, updates: Partial<Omit<Formation, 'id'>>) => ({
        id: 'f-1',
        name: updates.name ?? '3-3',
        slots: updates.slots ?? []
      })
    },
    async () => {
      await withPatchedSequenceDb(async () => {
        await updateFormation(req as any, res as any);
      });
    }
  );

  assert(res.statusCode === 200, 'PUT formations should return 200');
  const body = res.body as Formation;
  assert(body.name === '3-3 updated', 'PUT formations should update name');
};

const testDeleteFormationConflict = async (): Promise<void> => {
  const req = { params: { groupId: 'g-1', formationId: 'f-1' } };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      deleteFormationFromGroup: async () => ({ deleted: false, reason: 'in-use' as const })
    },
    async () => {
      await deleteFormation(req as any, res as any);
    }
  );

  assert(res.statusCode === 409, 'DELETE formation should return 409 when in use');
};

const testDeleteFormationSuccess = async (): Promise<void> => {
  const req = { params: { groupId: 'g-1', formationId: 'f-1' } };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      deleteFormationFromGroup: async () => ({ deleted: true })
    },
    async () => {
      await deleteFormation(req as any, res as any);
    }
  );

  assert(res.statusCode === 204, 'DELETE formation should return 204 on success');
};

const run = async (): Promise<void> => {
  const tests: Array<{ name: string; run: () => Promise<void> }> = [
    { name: '1) GET /playing-modes returns group modes', run: testGetPlayingModes },
    { name: '2) POST /playing-modes creates mode', run: testCreatePlayingMode },
    { name: '3) POST /playing-modes returns 400 for invalid payload', run: testCreatePlayingModeInvalidPayload },
    { name: '4) PUT /playing-modes/:id updates mode', run: testUpdatePlayingMode },
    { name: '5) DELETE /playing-modes/:id returns 409 when in use', run: testDeletePlayingModeConflict },
    { name: '6) POST /playing-modes/:id/set-default sets default', run: testSetDefaultPlayingMode },
    { name: '7) GET /formations returns group formations', run: testGetFormations },
    { name: '8) POST /formations creates formation with slot ids', run: testCreateFormation },
    { name: '9) POST /formations returns 400 when GK count is invalid', run: testCreateFormationInvalidGoalkeeperCount },
    { name: '10) POST /formations returns 400 for invalid position code', run: testCreateFormationInvalidPositionCode },
    { name: '11) PUT /formations/:id updates formation', run: testUpdateFormation },
    { name: '12) DELETE /formations/:id returns 409 when in use', run: testDeleteFormationConflict },
    { name: '13) DELETE /formations/:id returns 204 on success', run: testDeleteFormationSuccess },
    { name: '14) PUT /events/:id updates and returns playingModeId', run: testUpdateEventPlayingMode }
  ];

  for (const testCase of tests) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      console.error(`FAIL ${testCase.name}`);
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  console.log('All focused match-planning endpoint tests passed.');
};

run().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
