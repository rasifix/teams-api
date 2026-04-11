import { getAllGroups } from '../src/controllers/groupController';
import { getAllEvents, updateInvitationStatus } from '../src/controllers/eventController';
import { revokeRoleFromMember } from '../src/controllers/membersController';
import { requireGroupRole, GroupAuthRequest } from '../src/middleware/groupAuth';
import { dataStore } from '../src/data/store';
import { AuthRequest } from '../src/middleware/auth';
import { Event } from '../src/types';

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

const asAuthRequest = (value: unknown): AuthRequest => value as AuthRequest;
const asGroupAuthRequest = (value: unknown): GroupAuthRequest => value as GroupAuthRequest;

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

const testGetGroupsIsFilteredByMembership = async (): Promise<void> => {
  const req = {
    user: { id: 'user-1', email: 'u1@example.com' }
  };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      getUserById: async () => ({
        id: 'user-1',
        email: 'u1@example.com',
        password: 'hashed'
      }),
      getAllGroups: async () => [
        { id: 'g-1', name: 'Allowed Group' },
        { id: 'g-2', name: 'Hidden Group' }
      ],
      getUserGroupAccess: async (_userId: string, groupId: string) => {
        if (groupId === 'g-1') {
          return { memberId: 'm-1', roles: ['trainer'] };
        }

        return null;
      }
    },
    async () => {
      await getAllGroups(asAuthRequest(req), res as any);
    }
  );

  assert(res.statusCode === 200, 'GET /api/groups should return 200');
  const groups = res.body as Array<{ id: string; name: string }>;
  assert(Array.isArray(groups), 'GET /api/groups should return an array');
  assert(groups.length === 1, 'GET /api/groups should only include groups where user is a member');
  assert(groups[0].id === 'g-1', 'GET /api/groups should include only accessible group');
};

const runRequireRoleGuard = (allowedRoles: Array<'admin' | 'trainer'>): { statusCode: number; body: unknown; nextCalled: boolean } => {
  const middleware = requireGroupRole(allowedRoles);
  const req = {
    groupAccess: {
      memberId: 'guardian-member',
      groupId: 'g-1',
      roles: ['guardian']
    }
  };
  const res = createMockResponse();
  let nextCalled = false;

  middleware(asGroupAuthRequest(req), res as any, () => {
    nextCalled = true;
  });

  return {
    statusCode: res.statusCode,
    body: res.body,
    nextCalled
  };
};

const testGuardianCannotReadMembersShirtSetsEvaluations = async (): Promise<void> => {
  const membersGuard = runRequireRoleGuard(['admin', 'trainer']);
  const shirtSetsGuard = runRequireRoleGuard(['admin', 'trainer']);
  const evaluationsGuard = runRequireRoleGuard(['admin', 'trainer']);

  assert(!membersGuard.nextCalled && membersGuard.statusCode === 403, 'Guardian must not pass members read guard');
  assert(!shirtSetsGuard.nextCalled && shirtSetsGuard.statusCode === 403, 'Guardian must not pass shirt sets read guard');
  assert(!evaluationsGuard.nextCalled && evaluationsGuard.statusCode === 403, 'Guardian must not pass evaluations read guard');
};

const testGuardianInvitationStatusRestrictions = async (): Promise<void> => {
  const baseEvent: Event = {
    id: 'e-1',
    groupId: 'g-1',
    name: 'Match Day',
    date: '2026-04-11',
    maxPlayersPerTeam: 10,
    minPlayersPerTeam: 5,
    teams: [],
    invitations: [
      { id: 'i-1', playerId: 'child-1', status: 'open' },
      { id: 'i-2', playerId: 'other-1', status: 'open' }
    ]
  };

  const makeReq = (playerId: string, status: string): GroupAuthRequest => asGroupAuthRequest({
    params: { id: 'e-1', groupId: 'g-1', player_id: playerId } as any,
    body: { status },
    groupAccess: {
      memberId: 'guardian-member',
      groupId: 'g-1',
      roles: ['guardian']
    },
    user: { id: 'u-1', email: 'g@example.com' }
  });

  await withPatchedDataStore(
    {
      getEventById: async () => ({ ...baseEvent }),
      getGuardianChildPlayerIds: async () => ['child-1'],
      updateEvent: async (_id: string, updates: Partial<Omit<Event, 'id'>>) => ({
        ...baseEvent,
        invitations: updates.invitations ?? baseEvent.invitations
      })
    },
    async () => {
      const allowedRes = createMockResponse();
      await updateInvitationStatus(makeReq('child-1', 'accepted') as any, allowedRes as any);
      assert(allowedRes.statusCode === 200, 'Guardian should be allowed to accept invitation for own child');

      const forbiddenStatusRes = createMockResponse();
      await updateInvitationStatus(makeReq('child-1', 'injured') as any, forbiddenStatusRes as any);
      assert(forbiddenStatusRes.statusCode === 403, 'Guardian should not set invitation status beyond accepted/declined');

      const forbiddenChildRes = createMockResponse();
      await updateInvitationStatus(makeReq('other-1', 'accepted') as any, forbiddenChildRes as any);
      assert(forbiddenChildRes.statusCode === 403, 'Guardian should not update invitation for non-child player');
    }
  );
};

const testGuardianSeesOnlyChildRelevantEvents = async (): Promise<void> => {
  const events: Event[] = [
    {
      id: 'e-invite',
      groupId: 'g-1',
      name: 'Invited Event',
      date: '2026-04-11',
      maxPlayersPerTeam: 10,
      minPlayersPerTeam: 5,
      teams: [
        {
          id: 't-1',
          name: 'Team A',
          strength: 2,
          startTime: '09:00',
          selectedPlayers: ['other-1'],
          shirtSetId: 'ss-1',
          shirtAssignments: [{ playerId: 'other-1', shirtNumber: 7 }]
        }
      ],
      invitations: [
        { id: 'i-1', playerId: 'child-1', status: 'open' },
        { id: 'i-2', playerId: 'other-1', status: 'open' }
      ]
    },
    {
      id: 'e-selection',
      groupId: 'g-1',
      name: 'Selection Event',
      date: '2026-04-12',
      maxPlayersPerTeam: 10,
      minPlayersPerTeam: 5,
      teams: [
        {
          id: 't-2',
          name: 'Team B',
          strength: 1,
          startTime: '10:00',
          selectedPlayers: ['child-1', 'other-1'],
          shirtSetId: 'ss-2',
          shirtAssignments: [{ playerId: 'child-1', shirtNumber: 10 }]
        }
      ],
      invitations: []
    },
    {
      id: 'e-hidden',
      groupId: 'g-1',
      name: 'Hidden Event',
      date: '2026-04-13',
      maxPlayersPerTeam: 10,
      minPlayersPerTeam: 5,
      teams: [
        {
          id: 't-3',
          name: 'Team C',
          strength: 3,
          startTime: '11:00',
          selectedPlayers: ['other-1'],
          shirtSetId: 'ss-3',
          shirtAssignments: [{ playerId: 'other-1', shirtNumber: 2 }]
        }
      ],
      invitations: [{ id: 'i-3', playerId: 'other-1', status: 'open' }]
    }
  ];

  const req = {
    params: { groupId: 'g-1' },
    groupAccess: {
      memberId: 'guardian-member',
      groupId: 'g-1',
      roles: ['guardian']
    }
  };
  const res = createMockResponse();

  await withPatchedDataStore(
    {
      getAllEvents: async () => events,
      getGuardianChildPlayerIds: async () => ['child-1']
    },
    async () => {
      await getAllEvents(asGroupAuthRequest(req) as any, res as any);
    }
  );

  assert(res.statusCode === 200, 'Guardian event list should return 200');
  const visibleEvents = res.body as Event[];
  assert(Array.isArray(visibleEvents), 'Guardian event list should return array');
  assert(visibleEvents.length === 2, 'Guardian should only see events with child invitation or child selection');
  assert(!visibleEvents.some(event => event.id === 'e-hidden'), 'Guardian should not see unrelated events');

  const invitedEvent = visibleEvents.find(event => event.id === 'e-invite');
  assert(!!invitedEvent, 'Guardian should see invitation-relevant event');
  assert((invitedEvent?.invitations ?? []).every(inv => inv.playerId === 'child-1'), 'Guardian should only see own child invitations');

  const selectionEvent = visibleEvents.find(event => event.id === 'e-selection');
  assert(!!selectionEvent, 'Guardian should see selection-relevant event');
  const selectionTeamPlayers = selectionEvent?.teams?.[0]?.selectedPlayers ?? [];
  assert(selectionTeamPlayers.length === 1 && selectionTeamPlayers[0] === 'child-1', 'Guardian should only see own child in team selection');
  assert(selectionEvent?.teams?.[0]?.shirtSetId === undefined, 'Guardian should not see shirt set assignment details');
  assert(selectionEvent?.teams?.[0]?.shirtAssignments === undefined, 'Guardian should not see shirt assignment details');
};

const testRevokeRoleRules = async (): Promise<void> => {
  const makeReq = (role: string): GroupAuthRequest => asGroupAuthRequest({
    params: {
      groupId: 'g-1',
      id: 'm-1',
      role
    }
  });

  const baseMember = {
    id: 'm-1',
    groupId: 'g-1',
    roles: ['admin', 'trainer'] as Array<'admin' | 'trainer' | 'guardian'>,
    email: 'member@example.com'
  };

  await withPatchedDataStore(
    {
      getTrainerById: async () => baseMember,
      revokeRoleFromTrainer: async (_id: string, role: string) => {
        if (role === 'guardian') {
          return { reason: 'guardian-derived' as const };
        }

        if (role === 'admin') {
          return { reason: 'last-admin' as const };
        }

        return {
          updatedTrainer: {
            ...baseMember,
            roles: ['admin']
          }
        };
      }
    },
    async () => {
      const guardianRes = createMockResponse();
      await revokeRoleFromMember(makeReq('guardian') as any, guardianRes as any);
      assert(guardianRes.statusCode === 409, 'Guardian role revocation should be rejected');

      const adminRes = createMockResponse();
      await revokeRoleFromMember(makeReq('admin') as any, adminRes as any);
      assert(adminRes.statusCode === 409, 'Last admin role revocation should be rejected');

      const trainerRes = createMockResponse();
      await revokeRoleFromMember(makeReq('trainer') as any, trainerRes as any);
      assert(trainerRes.statusCode === 200, 'Trainer role revocation should be allowed when at least one role remains');
      const trainerBody = trainerRes.body as { roles?: string[] };
      assert(Array.isArray(trainerBody.roles) && trainerBody.roles.length === 1 && trainerBody.roles[0] === 'admin', 'Trainer role revocation should return member with remaining role');
    }
  );

  await withPatchedDataStore(
    {
      getTrainerById: async () => baseMember,
      revokeRoleFromTrainer: async () => ({ reason: 'last-role' as const })
    },
    async () => {
      const lastRoleRes = createMockResponse();
      await revokeRoleFromMember(makeReq('trainer') as any, lastRoleRes as any);
      assert(lastRoleRes.statusCode === 409, 'Role revocation should be rejected when it would leave member without roles');
    }
  );
};

const run = async (): Promise<void> => {
  const tests: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: '1) GET /api/groups returns only member groups',
      run: testGetGroupsIsFilteredByMembership
    },
    {
      name: '2) Guardian cannot read members/shirt sets/evaluations',
      run: testGuardianCannotReadMembersShirtSetsEvaluations
    },
    {
      name: '3) Guardian can only set accepted/declined for own children',
      run: testGuardianInvitationStatusRestrictions
    },
    {
      name: '4) Guardian sees only child-relevant events',
      run: testGuardianSeesOnlyChildRelevantEvents
    },
    {
      name: '5) Revoke role enforces role constraints',
      run: testRevokeRoleRules
    }
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

  console.log('All focused permission tests passed.');
};

run().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
