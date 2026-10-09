import { createGroup, updateGroup } from '../src/controllers/groupController';
import { createActivity, updateActivityInvitation } from '../src/controllers/activityController';
import { dataStore } from '../src/data/store';
import { mongoConnection } from '../src/database/connection';
import { getCategoryCatalog } from '../src/data/sfvCategories';
import {
  activityToEventDocument,
  eventDocumentToActivity,
  eventDocumentToLegacyEvent,
  eventToEventDocument
} from '../src/types/mappers';
import type { Activity, Event, Group, Trainer } from '../src/types';
import type { EventDocument } from '../src/types/mongodb';

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

const createMockResponse = (): MockResponse => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  }
});

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const withPatches = async <T>(
  patches: Partial<typeof dataStore>,
  run: () => Promise<T>
): Promise<T> => {
  const original = Object.entries(patches).map(([key]) => [key, (dataStore as any)[key]] as const);
  try {
    for (const [key, value] of Object.entries(patches)) (dataStore as any)[key] = value;
    return await run();
  } finally {
    for (const [key, value] of original) (dataStore as any)[key] = value;
  }
};

const withSequences = async <T>(run: () => Promise<T>): Promise<T> => {
  const originalGetDb = (mongoConnection as any).getDb;
  const counters = new Map<string, number>();
  try {
    (mongoConnection as any).getDb = () => ({
      collection: () => ({
        findOneAndUpdate: async ({ _id }: { _id: string }) => {
          const next = (counters.get(_id) ?? 0) + 1;
          counters.set(_id, next);
          return { sequence_value: next };
        }
      })
    });
    return await run();
  } finally {
    (mongoConnection as any).getDb = originalGetDb;
  }
};

const testCategoryCatalog = (): void => {
  const { categories } = getCategoryCatalog();
  assert(categories.A?.matchFormat?.name === '2x45', 'A should have the supplied 2x45 format');
  assert(categories.D7?.matchFormat?.minimumPeriodsPerPlayer === 2, 'D7 should require two periods per player');
  assert(categories.D9?.matchFormat?.maxPlayersPerTeam === 13, 'D9 should allow up to 13 players');
  assert(!categories.E?.matchFormat && categories.E?.activityType === 'tournament', 'E should be tournament-only');
  assert(!categories.F?.matchFormat && categories.F?.activityType === 'tournament', 'F should be tournament-only');
  assert(!categories.G?.matchFormat && categories.G?.activityType === 'tournament', 'G should be tournament-only');
};

const testCreateGroupCatalogSeeding = async (category: string, expectFormat: boolean): Promise<void> => {
  let captured: Group | undefined;
  const req: any = {
    body: { name: 'Group', category },
    user: { id: 'user-1' }
  };
  const res = createMockResponse();
  await withPatches({
    getUserById: async () => ({
      id: 'user-1',
      email: 'coach@example.test',
      firstName: 'Coach',
      lastName: 'One'
    }),
    createGroup: async (group: Group) => {
      captured = group;
      return group;
    },
    createTrainer: async (trainer: Trainer) => trainer
  }, async () => withSequences(async () => {
    await createGroup(req as any, res as any);
  }));

  assert(res.statusCode === 201, `Group creation for ${category} should succeed`);
  const formats = captured?.playingModes ?? [];
  assert(formats.length === (expectFormat ? 1 : 0), `${category} should seed the expected format count`);
  if (expectFormat) {
    assert(formats[0].isDefault, `${category} format should be the default`);
    assert(Boolean(formats[0].origin), `${category} format should record its origin`);
  }
};

const testUpdatingLegacyGroupPreservesFormats = async (): Promise<void> => {
  const originalFormat = {
    id: 'legacy-format',
    name: '3x20',
    numberOfPeriods: 3,
    periodLengthMinutes: 20,
    minimumPeriodsPerPlayer: 0,
    isDefault: true
  };
  let updateKeys: string[] = [];
  const res = createMockResponse();
  await withPatches({
    updateGroup: async (_id, updates) => {
      updateKeys = Object.keys(updates);
      return {
        id: 'legacy-squad',
        name: 'Legacy group',
        category: 'D7',
        playingModes: [originalFormat]
      };
    }
  }, async () => updateGroup({
    params: { id: 'legacy-squad' },
    body: { category: 'D7' }
  } as any, res as any));
  const returned = res.body as Group;
  assert(res.statusCode === 200, 'Updating a legacy group should succeed');
  assert(updateKeys.length === 1 && updateKeys[0] === 'category', 'Category update must not rewrite existing formats');
  assert(returned.playingModes?.[0].id === 'legacy-format', 'Legacy match formats should be preserved');
};

const testCreateActivityAndRejectUnacceptedSelection = async (): Promise<void> => {
  const req = {
    params: { groupId: 'squad-1' },
    body: {
      kind: 'match',
      name: 'Saturday match',
      startsAt: '2026-10-10T12:30:00.000Z',
      minPlayersPerTeam: 7,
      maxPlayersPerTeam: 11,
      invitations: [{ id: 'invite-1', playerId: 'player-1', response: 'open' }],
      teams: [{ id: 'team-1', name: 'Blue', selectedPlayers: [] }]
    }
  };
  const res = createMockResponse();
  let created: Activity | undefined;
  await withPatches({
    createActivity: async (activity: Activity) => {
      created = activity;
      return activity;
    }
  }, async () => withSequences(async () => {
    await createActivity(req as any, res as any);
  }));
  assert(res.statusCode === 201, 'Valid match activity should be created');
  assert(created?.kind === 'match' && created.squadId === 'squad-1', 'Created activity should be squad-scoped');

  req.body.teams[0].selectedPlayers = ['player-1'];
  const invalidResponse = createMockResponse();
  await withSequences(async () => createActivity(req as any, invalidResponse as any));
  assert(invalidResponse.statusCode === 400, 'Selecting a player without acceptance should be rejected');
};

const testGuardianDeclineReconcilesSelection = async (): Promise<void> => {
  const activity: Activity = {
    id: 'activity-1',
    squadId: 'squad-1',
    kind: 'match',
    name: 'Saturday match',
    startsAt: '2026-10-10T12:30:00.000Z',
    minPlayersPerTeam: 7,
    maxPlayersPerTeam: 11,
    teams: [{
      id: 'team-1',
      name: 'Blue',
      strength: 2,
      startTime: '12:30',
      selectedPlayers: ['player-1'],
      lineup: [{
        periodNumber: 1,
        assignments: [{ slotId: 'slot-1', playerId: 'player-1' }]
      }]
    }],
    invitations: [{ id: 'invite-1', playerId: 'player-1', response: 'accepted' }]
  };
  let updated: Activity | undefined;
  const req = {
    params: { groupId: 'squad-1', id: activity.id, playerId: 'player-1' },
    body: { response: 'declined', declineReason: 'injured' },
    groupAccess: { memberId: 'guardian-1', roles: ['guardian'] }
  };
  const res = createMockResponse();
  await withPatches({
    getActivityById: async () => activity,
    getGuardianChildPlayerIds: async () => ['player-1'],
    updateActivity: async (value: Activity) => {
      updated = value;
      return value;
    }
  }, async () => updateActivityInvitation(req as any, res as any));
  assert(res.statusCode === 200, 'Guardian should be able to decline their child invitation');
  assert(updated?.teams[0].selectedPlayers.length === 0, 'A declined player should be removed from team selection');
  assert(updated?.teams[0].lineup?.[0].assignments.length === 0, 'A declined player should be removed from lineup assignments');
};

const testLegacyEventRoundTrip = (): void => {
  const legacy: Omit<Event, 'id'> = {
    groupId: 'squad-1',
    name: 'Legacy game',
    date: '2026-10-10',
    minPlayersPerTeam: 1,
    maxPlayersPerTeam: 11,
    playingModeId: 'format-1',
    teams: [{
      id: 'team-1',
      name: 'First team',
      strength: 2,
      startTime: '12:30',
      selectedPlayers: ['player-1'],
      trainerId: 'trainer-1',
      responsiblePersonIds: ['trainer-1'],
      lineup: [{
        periodNumber: 1,
        assignments: [{ slotId: 'slot-1', playerId: 'player-1' }]
      }]
    }],
    invitations: [{ id: 'invite-1', playerId: 'player-1', status: 'injured' }]
  };
  const document = {
    _id: 'event-1',
    ...eventToEventDocument(legacy),
    createdAt: new Date(),
    updatedAt: new Date()
  } as EventDocument;
  const activity = eventDocumentToActivity(document);
  assert(activity.kind === 'match', 'A legacy event with one team should map to match');
  assert(activity.matchFormatId === 'format-1', 'Legacy playing mode should map to matchFormatId');
  assert(activity.invitations[0].response === 'declined', 'Legacy injury status should map to declined response');
  assert(activity.invitations[0].declineReason === 'injured', 'Legacy injury status should retain its reason');
  assert(activity.teams[0].responsiblePersonIds?.[0] === 'trainer-1', 'Legacy trainer should map to responsible person');
  const activityWrite = activityToEventDocument(activity);
  const legacyView = eventDocumentToLegacyEvent({
    _id: activity.id,
    ...activityWrite,
    createdAt: new Date(),
    updatedAt: new Date()
  } as EventDocument);
  assert(legacyView.playingModeId === 'format-1', 'Activity format should round-trip to legacy playingModeId');
  assert(legacyView.invitations[0].status === 'injured', 'Activity decline reason should round-trip to legacy status');
  assert(legacyView.teams[0].selectedPlayers.length === activity.teams[0].selectedPlayers.length, 'Activity write should preserve selected players');
  assert(legacyView.teams[0].lineup?.[0].assignments[0].playerId === 'player-1', 'Activity write should preserve lineup assignments');

  const noTeams = eventDocumentToActivity({
    ...document,
    kind: undefined,
    teams: []
  });
  assert(noTeams.kind === 'tournament', 'A legacy event with no teams should map to tournament');
};

const run = async (): Promise<void> => {
  testCategoryCatalog();
  await testCreateGroupCatalogSeeding('D9', true);
  await testCreateGroupCatalogSeeding('E', false);
  await testUpdatingLegacyGroupPreservesFormats();
  await testCreateActivityAndRejectUnacceptedSelection();
  await testGuardianDeclineReconcilesSelection();
  testLegacyEventRoundTrip();
  console.log('Phase 2-3 catalog and activity tests passed');
};

void run();
