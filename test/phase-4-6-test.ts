import {
  createActivityTask,
  createActivity,
  signUpForActivityTask,
  updateActivityInvitation,
  updateActivityAttendance,
  withdrawFromActivityTask
} from '../src/controllers/activityController';
import { dataStore } from '../src/data/store';
import { mongoConnection } from '../src/database/connection';
import { activityToEventDocument, eventDocumentToActivity, eventDocumentToLegacyEvent } from '../src/types/mappers';
import type { Activity, ActivityTask, EventDocument } from '../src/types';

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
  try {
    (mongoConnection as any).getDb = () => ({
      collection: () => ({
        findOneAndUpdate: async () => ({ sequence_value: 1 })
      })
    });
    return await run();
  } finally {
    (mongoConnection as any).getDb = originalGetDb;
  }
};

const baseActivity = (overrides: Partial<Activity> = {}): Activity => ({
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'social',
  name: 'Club social',
  startsAt: '2020-01-01T12:00:00.000Z',
  teams: [],
  invitations: [],
  ...overrides
});

const testAttendance = async (): Promise<void> => {
  let stored: Activity | undefined;
  const activity = baseActivity();
  const req = {
    params: { groupId: activity.squadId, id: activity.id },
    body: { attendance: [{ personId: 'member-1', status: 'present' }, { personId: 'member-2', status: 'excused' }] },
    groupAccess: { memberId: 'coach-1', roles: ['trainer'] }
  };
  const res = createMockResponse();
  await withPatches({
    getActivityById: async () => activity,
    getGroupMemberIds: async () => ['member-1', 'member-2'],
    updateActivity: async (value: Activity) => {
      stored = value;
      return value;
    }
  }, async () => updateActivityAttendance(req as any, res as any));
  assert(res.statusCode === 200, 'Trainer should record attendance after the activity starts');
  assert(stored?.attendance?.length === 2, 'Bulk attendance should upsert all supplied members');
  assert(stored?.invitations.length === 0, 'Attendance must be independent from invitations');
  assert(stored?.teams.length === 0, 'Attendance must be independent from team selection');

  const future = baseActivity({ startsAt: '2999-01-01T12:00:00.000Z' });
  const futureResponse = createMockResponse();
  await withPatches({
    getActivityById: async () => future,
    updateActivity: async (value: Activity) => value
  }, async () => updateActivityAttendance(req as any, futureResponse as any));
  assert(futureResponse.statusCode === 400, 'Attendance before activity start should be rejected');

  const invalidMemberResponse = createMockResponse();
  await withPatches({
    getActivityById: async () => activity,
    getGroupMemberIds: async () => ['member-1'],
    updateActivity: async (value: Activity) => value
  }, async () => updateActivityAttendance({
    ...req,
    body: { attendance: [{ personId: 'foreign-member', status: 'present' }] }
  } as any, invalidMemberResponse as any));
  assert(invalidMemberResponse.statusCode === 400, 'Attendance cannot reference a person outside the squad');
};

const testAdultTaskSignup = async (): Promise<void> => {
  let activity = baseActivity();
  const managerResponse = createMockResponse();
  const managerRequest = {
    params: { groupId: activity.squadId, id: activity.id },
    body: { name: 'Bring snacks', requiredPeople: 1 }
  };
  await withPatches({
    getActivityById: async () => activity,
    updateActivity: async (value: Activity) => {
      activity = value;
      return value;
    }
  }, async () => withSequences(async () => createActivityTask(managerRequest as any, managerResponse as any)));
  assert(managerResponse.statusCode === 200, 'Admin or trainer should create a task');
  assert(activity.tasks?.[0].isFulfilled === false, 'A task begins unfulfilled');

  const signup = async (memberId: string): Promise<MockResponse> => {
    const response = createMockResponse();
    await withPatches({
      getActivityById: async () => activity,
      updateActivity: async (value: Activity) => {
        activity = value;
        return value;
      }
    }, async () => signUpForActivityTask({
      params: { groupId: activity.squadId, id: activity.id, taskId: activity.tasks![0].id },
      groupAccess: { memberId, roles: ['guardian'] }
    } as any, response as any));
    return response;
  };

  assert((await signup('adult-1')).statusCode === 200, 'Adult guardian may sign themselves up');
  assert((await signup('adult-1')).statusCode === 200, 'Repeated signup should be idempotent');
  const secondSignup = await signup('adult-2');
  assert(secondSignup.statusCode === 200, 'Over-subscription should be allowed');
  const visibleTasks = secondSignup.body as ActivityTask[];
  assert(visibleTasks[0].signups.length === 1 && visibleTasks[0].signups[0].personId === 'adult-2',
    'Guardian signup response should not disclose other adults\' signup identities');
  assert(activity.tasks?.[0].signups.length === 2, 'Each adult member should appear at most once');
  assert(activity.tasks?.[0].isFulfilled === true, 'Fulfillment should turn true at requiredPeople');
  assert(activity.tasks?.[0].signups.every(signup => signup.personId !== 'child-1'), 'Signup must never use a child ID');

  const playerResponse = createMockResponse();
  await withPatches({
    getActivityById: async () => activity
  }, async () => signUpForActivityTask({
    params: { groupId: activity.squadId, id: activity.id, taskId: activity.tasks![0].id },
    groupAccess: { memberId: 'child-1', roles: ['player'] }
  } as any, playerResponse as any));
  assert(playerResponse.statusCode === 403, 'Player-role child cannot sign up for a task');

  const withdrawResponse = createMockResponse();
  await withPatches({
    getActivityById: async () => activity,
    updateActivity: async (value: Activity) => {
      activity = value;
      return value;
    }
  }, async () => withdrawFromActivityTask({
    params: { groupId: activity.squadId, id: activity.id, taskId: activity.tasks![0].id },
    groupAccess: { memberId: 'adult-1', roles: ['guardian'] }
  } as any, withdrawResponse as any));
  assert(withdrawResponse.statusCode === 200, 'Adult member can withdraw');
  assert(activity.tasks?.[0].isFulfilled === true, 'Task stays fulfilled when signup count still meets target');
};

const testTrainingAndSocialKinds = async (): Promise<void> => {
  const trainingResponse = createMockResponse();
  let created: Activity | undefined;
  const trainingRequest = {
    params: { groupId: 'squad-1' },
    body: {
      kind: 'training',
      name: 'Skills session',
      startsAt: '2026-10-09T10:00:00.000Z',
      trainerIds: ['trainer-1'],
      invitations: [{ id: 'invite-1', playerId: 'player-1', response: 'accepted' }],
      groups: [{ id: 'group-1', units: [{ id: 'unit-1', plannedPlayerIds: ['player-1'] }] }]
    }
  };
  await withPatches({
    createActivity: async (value: Activity) => {
      created = value;
      return value;
    }
  }, async () => withSequences(async () => createActivity(trainingRequest as any, trainingResponse as any)));
  assert(trainingResponse.statusCode === 201, 'Valid training activity should be created');
  assert(created?.teams.length === 0 && created.minPlayersPerTeam === undefined, 'Training should have no teams or roster limits');

  const invalidTrainingResponse = createMockResponse();
  trainingRequest.body.groups[0].units[0].plannedPlayerIds = ['unaccepted-player'];
  await withSequences(async () => createActivity(trainingRequest as any, invalidTrainingResponse as any));
  assert(invalidTrainingResponse.statusCode === 400, 'Training units cannot plan players without accepted invitations');

  const socialResponse = createMockResponse();
  await withPatches({
    createActivity: async (value: Activity) => {
      created = value;
      return value;
    }
  }, async () => withSequences(async () => createActivity({
    params: { groupId: 'squad-1' },
    body: {
      kind: 'social',
      name: 'Team dinner',
      startsAt: '2026-10-09T18:00:00.000Z',
      tasks: [{ id: 'forged-task', name: 'Forged', requiredPeople: 1, signups: [{ personId: 'child-1' }] }],
      attendance: [{ personId: 'child-1', status: 'present' }]
    }
  } as any, socialResponse as any)));
  assert(socialResponse.statusCode === 201, 'Social activities should be creatable without player limits');
  assert(created?.teams.length === 0 && created.maxPlayersPerTeam === undefined, 'Social activity should not have teams or player limits');
  assert(!created?.tasks && !created?.attendance, 'Activity create must not bypass task or attendance permissions');
};

const testTrainingDeclineReconcilesPlannedPlayers = async (): Promise<void> => {
  let stored = baseActivity({
    kind: 'training',
    trainerIds: ['trainer-1'],
    groups: [{ id: 'group-1', units: [{ id: 'unit-1', plannedPlayerIds: ['player-1'] }] }],
    invitations: [{ id: 'invite-1', playerId: 'player-1', response: 'accepted' }]
  });
  const res = createMockResponse();
  await withPatches({
    getActivityById: async () => stored,
    updateActivity: async (activity: Activity) => {
      stored = activity;
      return activity;
    }
  }, async () => updateActivityInvitation({
    params: { groupId: stored.squadId, id: stored.id, playerId: 'player-1' },
    body: { response: 'declined' },
    groupAccess: { memberId: 'trainer-1', roles: ['trainer'] }
  } as any, res as any));
  assert(res.statusCode === 200, 'Training invitation response should succeed');
  assert(stored.groups?.[0].units[0].plannedPlayerIds.length === 0, 'Declined players must be removed from training units');
};

const testNewFieldsStayOutOfLegacyView = (): void => {
  const activity = baseActivity({
    attendance: [{ personId: 'member-1', status: 'present' }],
    tasks: [{
      id: 'task-1',
      name: 'Bring snacks',
      requiredPeople: 1,
      signups: [{ personId: 'adult-1' }],
      isFulfilled: true
    }]
  });
  const document = {
    _id: activity.id,
    ...activityToEventDocument(activity),
    createdAt: new Date(),
    updatedAt: new Date()
  } as EventDocument;
  const activityView = eventDocumentToActivity(document);
  assert(activityView.tasks?.[0].isFulfilled === true, 'Task fulfillment should be computed on read');
  assert(activityView.attendance?.[0].status === 'present', 'Attendance should round-trip');
  const legacyView = eventDocumentToLegacyEvent(document);
  assert(!('attendance' in legacyView) && !('tasks' in legacyView), 'Legacy event payload must not expose Phase 4–6 fields');
};

const testLegacyEventsExcludeTrainingAndSocial = async (): Promise<void> => {
  const match = baseActivity({
    id: 'match-1',
    kind: 'match',
    minPlayersPerTeam: 1,
    maxPlayersPerTeam: 11,
    teams: [{
      id: 'team-1',
      name: 'Home',
      strength: 2,
      startTime: '12:00',
      selectedPlayers: []
    }]
  });
  const training = baseActivity({ id: 'training-1', kind: 'training', trainerIds: ['trainer-1'] });
  const social = baseActivity({ id: 'social-1', kind: 'social' });
  const docs = [match, training, social].map(activity => ({
    _id: activity.id,
    ...activityToEventDocument(activity),
    createdAt: new Date(),
    updatedAt: new Date()
  } as EventDocument));
  const originalGetEventsCollection = (mongoConnection as any).getEventsCollection;
  let deleted = false;
  try {
    (mongoConnection as any).getEventsCollection = () => ({
      find: () => ({ sort: () => ({ toArray: async () => docs }) }),
      findOne: async ({ _id }: { _id: string }) => docs.find(doc => doc._id === _id),
      deleteOne: async ({ _id, kind }: { _id: string; kind: { $nin: string[] } }) => {
        const eligible = docs.find(doc =>
          doc._id === _id && !kind.$nin.includes(doc.kind ?? '')
        );
        deleted = Boolean(eligible);
        return { deletedCount: eligible ? 1 : 0 };
      }
    });
    const events = await dataStore.getAllEvents('squad-1');
    assert(events.length === 1 && events[0].id === 'match-1', 'Legacy event listing must exclude training and social');
    assert(await dataStore.getEventById('training-1') === undefined, 'Legacy event details must exclude training');
    assert(await dataStore.getEventById('social-1') === undefined, 'Legacy event details must exclude social');
    assert(await dataStore.deleteEvent('social-1') === false && !deleted, 'Legacy event deletion must not delete a social activity');
  } finally {
    (mongoConnection as any).getEventsCollection = originalGetEventsCollection;
  }
};

const run = async (): Promise<void> => {
  await testAttendance();
  await testAdultTaskSignup();
  await testTrainingAndSocialKinds();
  await testTrainingDeclineReconcilesPlannedPlayers();
  testNewFieldsStayOutOfLegacyView();
  await testLegacyEventsExcludeTrainingAndSocial();
  console.log('Phase 4-6 attendance, task, training, and social tests passed');
};

void run();
