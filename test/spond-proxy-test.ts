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
    id: 'admin-1', firstName: 'Alex', lastName: 'Admin', guardians: []
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
    assert(snapshot.group.members.length === 1, 'trainers and administrators must be excluded from player snapshots');
    assert(snapshot.events[0].responses[0].response === 'accepted', 'accepted response must be preserved');
    assert(snapshot.events[0].responses[1].response === 'open', 'waiting-list response must map to open');
    assert(snapshot.events[0].responses[2].response === 'open', 'unconfirmed response must map to open');
    assert(snapshot.events[0].startsAt === '2026-10-10T12:00:00.000Z', 'Spond instants must convert to Zurich wall-clock time');
    assert(snapshot.events[0].location === 'Musterstrasse 12, 8000 Zürich', 'location must retain street, house number, and locality');
    assert(!JSON.stringify(snapshot).includes('secret-token'), 'snapshot must never expose the bearer token');
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

const run = async (): Promise<void> => {
  await testGroupSummaries();
  await testSnapshotNormalization();
  await testSanitizedErrors();
  console.log('Spond proxy tests passed');
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
