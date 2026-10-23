import { importSpondSnapshot } from '../src/controllers/spondImportController';
import { dataStore } from '../src/data/store';
import type { Activity, Player } from '../src/types';

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
    activities: [],
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
    updatePlayer: dataStore.updatePlayer,
    getActivityBySpondId: dataStore.getActivityBySpondId,
    getActivityById: dataStore.getActivityById,
    updateActivity: dataStore.updateActivity
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

    const activity: Activity = {
      id: 'activity-1', squadId: '5', spondId: 'se-1', kind: 'match', status: 'active', name: 'Match',
      startsAt: '2026-11-04T18:00:00.000Z', teams: [],
      invitations: [{ id: 'inv-1', playerId: 'p-1', response: 'accepted', respondedBy: 'trainer-1' }]
    };
    const activityBody = structuredClone(validBody);
    activityBody.snapshot.activities = [{
      id: 'se-1', groupId: 'sg-1', name: 'Match', type: 'match', status: 'active',
      startsAt: '2026-11-04T18:00:00.000Z', responses: [{ spondMemberId: 'sm-1', response: 'accepted' }]
    }];
    activityBody.activities = [{ action: 'link', spondEventId: 'se-1', activityId: 'activity-1' }];
    let storedActivity: Activity | undefined = { ...activity, spondId: undefined };
    let activityUpdates = 0;
    dataStore.getActivityBySpondId = async () => storedActivity?.spondId ? storedActivity : undefined;
    dataStore.getActivityById = async () => storedActivity;
    dataStore.updateActivity = async (value: Activity) => {
      activityUpdates += 1;
      storedActivity = value;
      return value;
    };
    const firstActivityImport = await call(activityBody);
    assert((firstActivityImport.response as { linked: number }).linked === 1, 'Spond activity should be linked');
    const secondActivityImport = await call(activityBody);
    assert((secondActivityImport.response as { unchanged: number }).unchanged === 2, 'unchanged Spond activity should be reported unchanged');
    assert(activityUpdates === 1, 'unchanged Spond invitations must not trigger another activity update');
  } finally {
    dataStore.getGroupById = original.getGroupById;
    dataStore.updateGroup = original.updateGroup;
    dataStore.getPlayerBySpondId = original.getPlayerBySpondId;
    dataStore.getPlayerById = original.getPlayerById;
    dataStore.updatePlayer = original.updatePlayer;
    dataStore.getActivityBySpondId = original.getActivityBySpondId;
    dataStore.getActivityById = original.getActivityById;
    dataStore.updateActivity = original.updateActivity;
  }
  console.log('Spond import tests passed');
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
