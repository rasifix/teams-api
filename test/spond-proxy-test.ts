import {
  listSpondGroups,
  readSpondSnapshot,
  SpondProxyError
} from '../src/services/spondService';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const jsonResponse = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

const withFetch = async (responses: Response[], run: (calls: Array<[string, RequestInit | undefined]>) => Promise<void>): Promise<void> => {
  const originalFetch = globalThis.fetch;
  const calls: Array<[string, RequestInit | undefined]> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push([String(input), init]);
    const response = responses.shift();
    if (!response) throw new Error('Unexpected fetch call');
    return response;
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const loginResponse = (): Response => jsonResponse({ accessToken: { token: 'secret-token' } });
const groupsResponse = (): Response => jsonResponse([{
  id: 'group-1',
  name: 'U12',
  members: [{
    id: 'member-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '2014-01-02',
    guardians: [{ id: 'guardian-1', firstName: 'Grace', lastName: 'Lovelace', email: 'grace@example.com' }]
  }, {
    id: 'trainer-1', firstName: 'Pat', lastName: 'Coach', guardians: [], roles: ['role-coach']
  }, {
    id: 'admin-1', firstName: 'Alex', lastName: 'Admin', guardians: [], roles: ['role-coach']
  }],
  admins: [{ id: 'admin-1' }],
  roles: [{ id: 'role-coach', name: 'Coach' }]
}]);

const testGroupSummaries = async (): Promise<void> => {
  await withFetch([loginResponse(), groupsResponse()], async calls => {
    const groups = await listSpondGroups('coach@example.com', 'password');
    assert(JSON.stringify(groups) === JSON.stringify([{ id: 'group-1', name: 'U12' }]), 'group proxy must omit member details');
    const loginBody = String(calls[0][1]?.body);
    assert(loginBody.includes('coach@example.com') && loginBody.includes('password'), 'login must forward credentials in the request body');
    assert((calls[1][1]?.headers as Record<string, string>).Authorization === 'Bearer secret-token', 'read must use the in-memory bearer token');
  });
};

const testSnapshotNormalization = async (): Promise<void> => {
  await withFetch([loginResponse(), groupsResponse(), jsonResponse([{
    id: 'event-1',
    type: 'match',
    heading: 'Training',
    startTimestamp: '2026-10-10T10:00:00.000Z',
    location: { feature: 'Musterstrasse 12', address: '8000 Zürich' },
    recipients: { group: { id: 'group-1' } },
    responses: {
      acceptedIds: ['member-1'],
      waitinglistIds: ['member-2'],
      unconfirmedIds: ['member-3']
    }
  }])], async () => {
    const snapshot = await readSpondSnapshot(
      'coach@example.com',
      'password',
      'group-1',
      '2026-01-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z'
    );
    assert(snapshot.group.members[0].birthDate === '2014-01-02', 'birth date must be normalized');
    assert(snapshot.group.members.length === 3, 'administrator-only entries must be excluded while administrators with trainer roles remain available for trainer synchronization');
    assert(snapshot.group.members.some(member => member.id === 'trainer-1' && member.roles.includes('Coach')), 'trainer role names must be normalized and retained');
    assert(snapshot.group.members.some(member => member.id === 'admin-1' && member.roles.includes('Coach')), 'administrator members with trainer roles must be retained');
    assert(snapshot.activities[0].responses[0].response === 'accepted', 'accepted response must be preserved');
    assert(snapshot.activities[0].responses[1].response === 'open', 'waiting-list response must map to open');
    assert(snapshot.activities[0].responses[2].response === 'open', 'unconfirmed response must map to open');
    assert(snapshot.activities[0].startsAt === '2026-10-10T10:00:00.000Z', 'Offset-bearing Spond timestamps must preserve their instant in UTC');
    assert(snapshot.activities[0].location === 'Musterstrasse 12, 8000 Zürich', 'location must retain street, house number, and locality');
    assert(!JSON.stringify(snapshot).includes('secret-token'), 'snapshot must never expose the bearer token');
  });
};

const testTimestampTimezoneNormalization = async (): Promise<void> => {
  await withFetch([loginResponse(), groupsResponse(), jsonResponse([{
    id: 'summer-local', type: 'match', heading: 'Summer local', startTimestamp: '2026-07-10T18:30:00',
    timeZone: 'Europe/Zurich', recipients: { group: { id: 'group-1' } }, responses: {}
  }, {
    id: 'winter-local', type: 'match', heading: 'Winter local', startTimestamp: '2026-12-10T18:30:00',
    timeZone: 'Europe/Zurich', recipients: { group: { id: 'group-1' } }, responses: {}
  }, {
    id: 'explicit-offset', type: 'match', heading: 'Explicit offset', startTimestamp: '2026-07-10T18:30:00+02:00',
    recipients: { group: { id: 'group-1' } }, responses: {}
  }])], async () => {
    const snapshot = await readSpondSnapshot(
      'coach@example.com', 'password', 'group-1',
      '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'
    );
    const events = new Map(snapshot.activities.map(event => [event.id, event]));
    assert(events.get('summer-local')?.startsAt === '2026-07-10T16:30:00.000Z', 'Zurich summer time must use UTC+02:00');
    assert(events.get('winter-local')?.startsAt === '2026-12-10T17:30:00.000Z', 'Zurich winter time must use UTC+01:00');
    assert(events.get('explicit-offset')?.startsAt === '2026-07-10T16:30:00.000Z', 'Explicit source offsets must be honored');
  });
};

const testSanitizedErrors = async (): Promise<void> => {
  await withFetch([jsonResponse({ message: 'raw secret provider error' }, 401)], async () => {
    try {
      await listSpondGroups('coach@example.com', 'wrong');
      throw new Error('Expected login to fail');
    } catch (error) {
      assert(error instanceof SpondProxyError, 'provider failure must become a SpondProxyError');
      assert((error as SpondProxyError).code === 'SPOND_AUTH_FAILED', 'provider body must be replaced with a safe code');
      assert(!(error as Error).message.includes('raw secret'), 'raw provider errors must not escape');
    }
  });

  await withFetch([loginResponse(), groupsResponse(), jsonResponse([{
    id: 'event-1',
    type: 'match',
    heading: 'Training',
    startTimestamp: '2026-10-10T10:00:00.000Z',
    recipients: { group: { id: 'group-1' } },
    responses: { acceptedIds: ['member-1'], declinedIds: ['member-1'] }
  }])], async () => {
    try {
      await readSpondSnapshot('coach@example.com', 'password', 'group-1', '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
      throw new Error('Expected conflicting responses to fail');
    } catch (error) {
      assert(error instanceof SpondProxyError && error.code === 'SPOND_CONFLICTING_RESPONSES', 'conflicting response lists must fail safely');
    }
  });
};

const groupsWithSubgroupsResponse = (): Response => jsonResponse([{
  id: 'group-1',
  name: 'Junioren E',
  subGroups: [
    { id: 'subgroup-1', name: 'E1 Blau', color: '#0000ff' },
    { id: 'subgroup-2', name: 'E2 Gelb', color: '#ffff00' }
  ],
  members: [
    {
      id: 'member-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '2014-01-02',
      subGroups: ['subgroup-1'],
      guardians: null
    },
    {
      id: 'member-2',
      firstName: 'Charles',
      lastName: 'Babbage',
      dateOfBirth: '2014-03-04',
      subGroups: ['subgroup-2'],
      guardians: []
    },
    {
      id: 'member-3',
      firstName: 'Alan',
      lastName: 'Turing',
      dateOfBirth: '2014-05-06',
      subGroups: [{ id: 'subgroup-1' }, { id: 'subgroup-2' }],
      guardians: []
    },
    {
      id: 'trainer-1',
      firstName: 'Pat',
      lastName: 'Coach',
      subGroups: ['subgroup-1'],
      guardians: [],
      roles: ['role-coach']
    }
  ],
  admins: [],
  roles: [{ id: 'role-coach', name: 'Coach' }]
}]);

const testGroupSummariesWithSubgroups = async (): Promise<void> => {
  await withFetch([loginResponse(), groupsWithSubgroupsResponse()], async () => {
    const groups = await listSpondGroups('coach@example.com', 'password');
    assert(groups.length === 1, 'must return one group');
    assert(groups[0].id === 'group-1', 'group ID must match');
    assert(groups[0].name === 'Junioren E', 'group name must match');
    assert(Array.isArray(groups[0].subGroups) && groups[0].subGroups.length === 2, 'must include subGroups');
    assert(groups[0].subGroups![0].id === 'subgroup-1' && groups[0].subGroups![0].name === 'E1 Blau', 'subgroup 1 details must match');
    assert(groups[0].subGroups![1].id === 'subgroup-2' && groups[0].subGroups![1].name === 'E2 Gelb', 'subgroup 2 details must match');
  });
};

const testSubgroupSnapshotBySubgroupIdDirectly = async (): Promise<void> => {
  await withFetch([
    loginResponse(),
    groupsWithSubgroupsResponse(),
    jsonResponse([
      {
        id: 'event-1',
        type: 'match',
        heading: 'Training E1',
        startTimestamp: '2026-10-10T10:00:00.000Z',
        recipients: { group: { id: 'group-1', subGroups: ['subgroup-1'] } },
        responses: { acceptedIds: ['member-1'] }
      },
      {
        id: 'event-2',
        type: 'match',
        name: 'Match E1',
        startTimestamp: '2026-10-12T10:00:00.000Z',
        recipients: { subGroups: [{ id: 'subgroup-1' }] },
        responses: {}
      },
      {
        id: 'event-3',
        type: 'match',
        heading: 'Club Day',
        startTimestamp: '2026-10-14T10:00:00.000Z',
        recipients: {},
        responses: {}
      }
    ])
  ], async calls => {
    const snapshot = await readSpondSnapshot(
      'coach@example.com',
      'password',
      'subgroup-1',
      '2026-01-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z'
    );

    // Verify Spond /sponds was called with parent groupId and subGroupId
    const spondUrl = String(calls[2][0]);
    assert(spondUrl.includes('groupId=group-1'), 'Spond request must use parent groupId');
    assert(spondUrl.includes('subGroupId=subgroup-1'), 'Spond request must include subGroupId parameter');

    // Verify snapshot group details
    assert(snapshot.group.id === 'subgroup-1', 'snapshot group ID must be the subgroup ID');
    assert(snapshot.group.name === 'E1 Blau', 'snapshot group name must be the subgroup name');

    // Verify member filtering
    assert(snapshot.group.members.length === 3, 'members and trainers assigned to subgroup-1 must be included');
    const memberIds = snapshot.group.members.map(m => m.id);
    assert(memberIds.includes('member-1'), 'member-1 must be included');
    assert(memberIds.includes('member-3'), 'member-3 must be included');
    assert(!memberIds.includes('member-2'), 'member-2 belonging only to subgroup-2 must be excluded');
    assert(memberIds.includes('trainer-1'), 'trainer assigned to subgroup-1 must be included');

    // Verify null guardians handling did not crash
    assert(Array.isArray(snapshot.group.members[0].guardians) && snapshot.group.members[0].guardians.length === 0, 'null guardians must normalize to empty array');

    // Verify events
    assert(snapshot.activities.length === 3, 'all activities applicable to subgroup must be included');
    for (const ev of snapshot.activities) {
      assert(ev.groupId === 'subgroup-1', 'event groupId must match subgroup ID');
    }
    assert(snapshot.activities[1].name === 'Match E1', 'activity name fallback must work when heading is absent');
  });
};

const testSubgroupSnapshotWithExplicitSubgroupId = async (): Promise<void> => {
  await withFetch([
    loginResponse(),
    groupsWithSubgroupsResponse(),
    jsonResponse([
      {
        id: 'event-sub2',
        type: 'match',
        name: 'Training E2',
        startTimestamp: '2026-10-10T10:00:00.000Z',
        recipients: { group: { id: 'group-1' }, subGroups: ['subgroup-2'] },
        responses: { acceptedIds: ['member-2'] }
      }
    ])
  ], async calls => {
    const snapshot = await readSpondSnapshot(
      'coach@example.com',
      'password',
      'group-1',
      '2026-01-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
      'subgroup-2'
    );

    const spondUrl = String(calls[2][0]);
    assert(spondUrl.includes('groupId=group-1'), 'Spond request must use parent groupId');
    assert(spondUrl.includes('subGroupId=subgroup-2'), 'Spond request must include subGroupId parameter');

    assert(snapshot.group.id === 'subgroup-2', 'snapshot group ID must be subgroup-2');
    assert(snapshot.group.name === 'E2 Gelb', 'snapshot group name must be E2 Gelb');
    assert(snapshot.group.members.length === 2, 'members for subgroup-2 must include member-2 and member-3');
    const memberIds = snapshot.group.members.map(m => m.id);
    assert(memberIds.includes('member-2') && memberIds.includes('member-3'), 'correct members included');
    assert(!memberIds.includes('member-1'), 'member-1 excluded');
    assert(snapshot.activities.length === 1 && snapshot.activities[0].groupId === 'subgroup-2', 'activity groupId must match subgroup-2');
  });
};

const testGroupSummariesWithVariousSubgroupFormats = async (): Promise<void> => {
  await withFetch([
    loginResponse(),
    jsonResponse([{
      id: 'group-1',
      name: 'Junioren D',
      subGroups: [
        'subgroup-string-id',
        { id: 'subgroup-without-name' },
        { id: 'subgroup-3', name: 'D3 Rot', color: '#ff0000' }
      ],
      members: []
    }])
  ], async () => {
    const groups = await listSpondGroups('coach@example.com', 'password');
    assert(groups.length === 1, 'group must be returned');
    assert(groups[0].subGroups?.length === 3, 'all 3 valid/coerced subgroups must be returned');
    assert(groups[0].subGroups![0].id === 'subgroup-string-id' && groups[0].subGroups![0].name === 'subgroup-string-id', 'string subgroup id must be accepted');
    assert(groups[0].subGroups![1].id === 'subgroup-without-name' && groups[0].subGroups![1].name === 'subgroup-without-name', 'subgroup without name must fallback to id');
    assert(groups[0].subGroups![2].id === 'subgroup-3' && groups[0].subGroups![2].name === 'D3 Rot', 'regular subgroup must be parsed');
  });
};

const run = async (): Promise<void> => {
  await testGroupSummaries();
  await testGroupSummariesWithSubgroups();
  await testGroupSummariesWithVariousSubgroupFormats();
  await testSnapshotNormalization();
  await testTimestampTimezoneNormalization();
  await testSubgroupSnapshotBySubgroupIdDirectly();
  await testSubgroupSnapshotWithExplicitSubgroupId();
  await testSanitizedErrors();
  console.log('Spond proxy tests passed');
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
