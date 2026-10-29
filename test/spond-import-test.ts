import { importSpondSnapshot } from '../src/controllers/spondImportController';
import { dataStore } from '../src/data/store';
import { mongoConnection } from '../src/database/connection';
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
  trainers: [],
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
    updateActivity: dataStore.updateActivity,
    getTrainerBySpondId: dataStore.getTrainerBySpondId,
    getTrainerById: dataStore.getTrainerById,
    createTrainer: dataStore.createTrainer,
    updateTrainer: dataStore.updateTrainer,
    addMemberRole: dataStore.addMemberRole
  };
  const originalGetDb = mongoConnection.getDb;
  const player: Player = {
    id: 'p-1', groupId: '5', roles: ['player'], firstName: 'Ada', lastName: 'Lovelace',
    birthDate: '2014-01-02', level: 3, status: 'active'
  };
  let linkedSpondId = '';
  try {
    (mongoConnection as any).getDb = () => ({
      collection: () => ({ findOneAndUpdate: async () => ({ sequence_value: 123 }) }),
    });
    dataStore.getGroupById = async () => ({ id: '5', name: 'Local U12' });
    dataStore.updateGroup = async (_id, updates) => ({ id: '5', name: 'Local U12', ...updates });
    dataStore.getPlayerBySpondId = async () => undefined;
    dataStore.getPlayerById = async () => player;
    dataStore.getTrainerBySpondId = async () => undefined;
    dataStore.updatePlayer = async (_id, updates) => {
      linkedSpondId = String(updates.spondId);
      return { ...player, ...updates };
    };

    const success = await call(validBody);
    assert(success.status === 200, 'valid link-only import must succeed');
    assert(linkedSpondId === 'sm-1', 'link import must persist the Spond member id');
    assert((success.response as { linked: number }).linked === 1, 'link result must be counted');

    const trainerSourceBody = structuredClone(validBody);
    trainerSourceBody.snapshot.group.members.push({
      id: 'sm-trainer', firstName: 'Pat', lastName: 'Coach', roles: ['coach'], guardians: [],
    });
    trainerSourceBody.members = [{ action: 'skip', spondMemberId: 'sm-trainer' }];
    trainerSourceBody.trainers = [{ action: 'create-trainer', spondMemberId: 'sm-trainer' }];
    let createdTrainer: Record<string, unknown> | undefined;
    dataStore.getTrainerBySpondId = async () => undefined;
    dataStore.getPlayerBySpondId = async () => undefined;
    dataStore.createTrainer = async value => { createdTrainer = value as unknown as Record<string, unknown>; return value; };
    const trainerImport = await call(trainerSourceBody);
    assert(trainerImport.status === 200, 'valid trainer creation must succeed');
    assert(createdTrainer?.spondId === 'sm-trainer'
      && Array.isArray(createdTrainer.roles) && createdTrainer.roles.includes('trainer'),
    'created trainer must retain its Spond ID and trainer role');
    assert((trainerImport.response as { created: number }).created === 1, 'created trainer must be counted');

    const dualRoleBody = structuredClone(trainerSourceBody);
    dualRoleBody.members = [{
      action: 'create-player', spondMemberId: 'sm-trainer', birthDate: '2014-02-03', level: 2, status: 'active', guardianIds: [],
    }];
    dualRoleBody.trainers = [{ action: 'skip', spondMemberId: 'sm-trainer' }];
    let playerLookupCount = 0;
    let promotedRole = '';
    dataStore.getTrainerBySpondId = async () => createdTrainer as unknown as import('../src/types').Trainer;
    dataStore.getPlayerBySpondId = async () => {
      playerLookupCount += 1;
      return playerLookupCount === 1 ? undefined : player;
    };
    dataStore.addMemberRole = async (_id, role) => { promotedRole = role; return true; };
    const dualRoleImport = await call(dualRoleBody);
    assert(dualRoleImport.status === 200, 'the same Spond person may gain a player role without duplicating the member record');
    assert(promotedRole === 'player', 'player sync must add the player role to the linked trainer record');
    assert((dualRoleImport.response as { updated: number }).updated === 1, 'promoted trainer/player must be updated as a player');

    const invalidTrainerBody = structuredClone(validBody);
    invalidTrainerBody.trainers = [{ action: 'create-trainer', spondMemberId: 'sm-1' }];
    const invalidTrainer = await call(invalidTrainerBody);
    assert(invalidTrainer.status === 400, 'a non-trainer Spond member must not be imported as a trainer');

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
    (mongoConnection as any).getDb = originalGetDb;
    dataStore.getGroupById = original.getGroupById;
    dataStore.updateGroup = original.updateGroup;
    dataStore.getPlayerBySpondId = original.getPlayerBySpondId;
    dataStore.getPlayerById = original.getPlayerById;
    dataStore.updatePlayer = original.updatePlayer;
    dataStore.getActivityBySpondId = original.getActivityBySpondId;
    dataStore.getActivityById = original.getActivityById;
    dataStore.updateActivity = original.updateActivity;
    dataStore.getTrainerBySpondId = original.getTrainerBySpondId;
    dataStore.getTrainerById = original.getTrainerById;
    dataStore.createTrainer = original.createTrainer;
    dataStore.updateTrainer = original.updateTrainer;
    dataStore.addMemberRole = original.addMemberRole;
  }
  console.log('Spond import tests passed');
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
