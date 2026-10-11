import { importSpondSnapshot } from '../src/controllers/spondImportController';
import { dataStore } from '../src/data/store';
import type { Player } from '../src/types';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const call = async (body: unknown) => {
  let status = 200;
  let response: unknown;
  const req = { params: { groupId: '5' }, body } as never;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { response = value; return this; }
  } as never;
  await importSpondSnapshot(req, res);
  return { status, response };
};

const validBody = {
  importId: 'import-1',
  spondGroupId: 'sg-1',
  from: '2026-01-01',
  to: '2026-12-31',
  snapshot: {
    group: {
      id: 'sg-1', name: 'U12',
      members: [{ id: 'sm-1', firstName: 'Ada', lastName: 'Lovelace', guardians: [], roles: [] }]
    },
    events: [],
    sourceReadAt: '2026-10-10T10:00:00.000Z'
  },
  members: [{ action: 'link', spondMemberId: 'sm-1', memberId: 'p-1' }],
  activities: []
};

const run = async (): Promise<void> => {
  const invalid = await call({});
  assert(invalid.status === 400, 'invalid payload must be rejected');

  const original = {
    getGroupById: dataStore.getGroupById,
    updateGroup: dataStore.updateGroup,
    getPlayerBySpondId: dataStore.getPlayerBySpondId,
    getPlayerById: dataStore.getPlayerById,
    updatePlayer: dataStore.updatePlayer
  };
  const player: Player = {
    id: 'p-1', groupId: '5', roles: ['player'], firstName: 'Ada', lastName: 'Lovelace',
    birthDate: '2014-01-02', level: 3, status: 'active'
  };
  let linkedSpondId = '';
  try {
    dataStore.getGroupById = async () => ({ id: '5', name: 'Local U12' });
    dataStore.updateGroup = async (_id, updates) => ({ id: '5', name: 'Local U12', ...updates });
    dataStore.getPlayerBySpondId = async () => undefined;
    dataStore.getPlayerById = async () => player;
    dataStore.updatePlayer = async (_id, updates) => {
      linkedSpondId = String(updates.spondId);
      return { ...player, ...updates };
    };

    const success = await call(validBody);
    assert(success.status === 200, 'valid link-only import must succeed');
    assert(linkedSpondId === 'sm-1', 'link import must persist the Spond member id');
    assert((success.response as { linked: number }).linked === 1, 'link result must be counted');

    dataStore.getPlayerById = async () => ({ ...player, spondId: 'sm-1' });
    const changedBirthDateBody = structuredClone(validBody);
    changedBirthDateBody.snapshot.group.members[0] = {
      ...changedBirthDateBody.snapshot.group.members[0], birthDate: '2015-03-04'
    };
    const update = await call(changedBirthDateBody);
    assert(update.status === 200, 'an already-linked player update must succeed');
    assert((update.response as { updated: number }).updated === 1, 'changed linked player must be counted as updated');
  } finally {
    dataStore.getGroupById = original.getGroupById;
    dataStore.updateGroup = original.updateGroup;
    dataStore.getPlayerBySpondId = original.getPlayerBySpondId;
    dataStore.getPlayerById = original.getPlayerById;
    dataStore.updatePlayer = original.updatePlayer;
  }
  console.log('Spond import tests passed');
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
