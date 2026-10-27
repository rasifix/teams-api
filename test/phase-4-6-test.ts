import {
  updateActivityAttendance,
} from '../src/controllers/activityController';
import { dataStore } from '../src/data/store';
import { activityToEventDocument, eventDocumentToActivity, eventDocumentToLegacyEvent } from '../src/types/mappers';
import type { Activity, EventDocument } from '../src/types';

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  setHeader: (name: string, value: string) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

const createMockResponse = (): MockResponse => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader() {
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

const baseActivity = (overrides: Partial<Activity> = {}): Activity => ({
  id: 'activity-1',
  squadId: 'squad-1',
  kind: 'match',
  status: 'active',
  name: 'Club match',
  startsAt: '2020-01-01T12:00:00.000Z',
  minPlayersPerTeam: 1,
  maxPlayersPerTeam: 11,
  teams: [{ id: 'team-1', name: 'Home', strength: 2, selectedPlayers: [] }],
  invitations: [],
  ...overrides
});

const testAttendance = async (): Promise<void> => {
  let stored: Activity | undefined;
  const activity = baseActivity({ attendance: [{ personId: 'member-1', status: 'excused', reason: 'old reason' }] });
  const req = {
    params: { groupId: activity.squadId, id: activity.id },
    body: { attendance: [{ personId: 'member-2', status: 'excused' }] },
    groupAccess: { memberId: 'coach-1', roles: ['trainer'] }
  };
  const res = createMockResponse();
  await withPatches({
    getActivityById: async () => activity,
    getActivityRevision: async () => 1,
    getGroupMemberIds: async () => ['member-1', 'member-2'],
    updateActivity: async (value: Activity) => {
      stored = value;
      return value;
    }
  }, async () => updateActivityAttendance(req as any, res as any));
  assert(res.statusCode === 200, 'Trainer should record attendance after the activity starts');
  assert(stored?.attendance?.length === 2, 'Bulk attendance should upsert all supplied members');
  assert(stored?.attendance?.[0].reason === 'old reason', 'Updating another attendance row preserves the existing reason');
  assert(stored?.invitations.length === 0, 'Attendance must be independent from invitations');
  assert(stored?.teams.length === 1 && stored.teams[0].id === 'team-1', 'Attendance must be independent from team selection');

  const future = baseActivity({ startsAt: '2999-01-01T12:00:00.000Z' });
  const futureResponse = createMockResponse();
  await withPatches({
    getActivityById: async () => future,
    getActivityRevision: async () => 1,
    updateActivity: async (value: Activity) => value
  }, async () => updateActivityAttendance(req as any, futureResponse as any));
  assert(futureResponse.statusCode === 400, 'Attendance before activity start should be rejected');

  const invalidMemberResponse = createMockResponse();
  await withPatches({
    getActivityById: async () => activity,
    getActivityRevision: async () => 1,
    getGroupMemberIds: async () => ['member-1'],
    updateActivity: async (value: Activity) => value
  }, async () => updateActivityAttendance({
    ...req,
    body: { attendance: [{ personId: 'foreign-member', status: 'present' }] }
  } as any, invalidMemberResponse as any));
  assert(invalidMemberResponse.statusCode === 400, 'Attendance cannot reference a person outside the squad');
};

const testNewFieldsStayOutOfLegacyView = (): void => {
  const activity = baseActivity({
    attendance: [{ personId: 'member-1', status: 'excused', reason: 'sick' }]
  });
  const document = {
    _id: activity.id,
    ...activityToEventDocument(activity),
    createdAt: new Date(),
    updatedAt: new Date()
  } as EventDocument;
  const activityView = eventDocumentToActivity(document);
  assert(activityView.attendance?.[0].status === 'excused', 'Attendance should round-trip');
  assert(activityView.attendance?.[0].reason === 'sick', 'Attendance reason should round-trip');
  const legacyView = eventDocumentToLegacyEvent(document);
  assert(!('attendance' in legacyView), 'Legacy event payload must not expose Phase 4–6 fields');
};

const run = async (): Promise<void> => {
  await testAttendance();
  testNewFieldsStayOutOfLegacyView();
  console.log('Phase 4-6 attendance and legacy compatibility tests passed');
};

void run();
