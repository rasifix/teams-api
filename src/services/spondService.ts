const SPOND_API_URL = 'https://api.spond.com/core/v1';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS_PER_REQUEST = 100;
const MAX_SPLIT_DEPTH = 12;
const APP_TIME_ZONE = 'Europe/Zurich';

type UnknownRecord = Record<string, unknown>;

export interface SpondGroupSummary {
  id: string;
  name: string;
}

export interface SpondGuardianSnapshot {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface SpondMemberSnapshot {
  id: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  guardians: SpondGuardianSnapshot[];
  roles: string[];
}

export interface SpondEventSnapshot {
  id: string;
  groupId: string;
  name: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  responses: Array<{
    spondMemberId: string;
    response: 'open' | 'accepted' | 'declined';
  }>;
}

export interface SpondSnapshot {
  group: SpondGroupSummary & { members: SpondMemberSnapshot[] };
  events: SpondEventSnapshot[];
  sourceReadAt: string;
}

export class SpondProxyError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = 'SpondProxyError';
  }
}

const asRecord = (value: unknown): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  }
  return value as UnknownRecord;
};

const requiredString = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  }
  return value.trim();
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const toAppWallClock = (value: string): string => {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new SpondProxyError('SPOND_INVALID_TIMESTAMP', 502);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(entry => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}.${String(instant.getUTCMilliseconds()).padStart(3, '0')}Z`;
};

const roleNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const role = entry as UnknownRecord;
    return [optionalString(role.name) ?? optionalString(role.type) ?? optionalString(role.label)].filter((name): name is string => Boolean(name));
  });
};

const roleLookup = (group: UnknownRecord): Map<string, string> => {
  if (!Array.isArray(group.roles)) return new Map();
  return new Map(group.roles.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const role = value as UnknownRecord;
    const id = optionalString(role.id);
    const name = optionalString(role.name) ?? optionalString(role.label);
    return id && name ? [[id, name] as const] : [];
  }));
};

const adminIds = (group: UnknownRecord): Set<string> => {
  const values = [group.admins, group.administrators].filter(Array.isArray).flat() as unknown[];
  return new Set(values.flatMap(value => {
    if (typeof value === 'string') return [value];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const admin = value as UnknownRecord;
    const id = optionalString(admin.memberId) ?? optionalString(admin.id);
    return id ? [id] : [];
  }));
};

const isTrainerRole = (role: string): boolean => /(^|\s)(admin(istrator)?|coach|trainer)(\s|$)/i.test(role);

const stringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  }
  return value as string[];
};

const normalizeGuardian = (value: unknown): SpondGuardianSnapshot => {
  const guardian = asRecord(value);
  const profile = guardian.profile && typeof guardian.profile === 'object'
    ? asRecord(guardian.profile)
    : {};
  return {
    id: requiredString(guardian.id),
    firstName: requiredString(guardian.firstName),
    lastName: requiredString(guardian.lastName),
    email: optionalString(guardian.email) ?? optionalString(profile.email)
  };
};

const normalizeMember = (value: unknown, rolesById: Map<string, string>): SpondMemberSnapshot => {
  const member = asRecord(value);
  const guardians = member.guardians === undefined ? [] : member.guardians;
  if (!Array.isArray(guardians)) throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  return {
    id: requiredString(member.id),
    firstName: requiredString(member.firstName),
    lastName: requiredString(member.lastName),
    birthDate: optionalString(member.dateOfBirth) ?? optionalString(member.birthDate),
    guardians: guardians.map(normalizeGuardian),
    roles: roleNames(member.roles).map(role => rolesById.get(role) ?? role)
  };
};

const normalizeGroup = (value: unknown): SpondSnapshot['group'] => {
  const group = asRecord(value);
  if (!Array.isArray(group.members)) throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  const administrators = adminIds(group);
  const rolesById = roleLookup(group);
  return {
    id: requiredString(group.id),
    name: requiredString(group.name),
    members: group.members
      .map(member => normalizeMember(member, rolesById))
      .filter(member => !administrators.has(member.id) && !member.roles.some(isTrainerRole))
  };
};

const normalizeLocation = (value: unknown): string | undefined => {
  if (typeof value === 'string') return optionalString(value);
  if (!value || typeof value !== 'object') return undefined;
  const location = asRecord(value);
  const parts = [optionalString(location.name), optionalString(location.feature), optionalString(location.address)]
    .filter((part): part is string => Boolean(part));
  return parts.filter((part, index) => !parts.some((other, otherIndex) => otherIndex < index && other.toLocaleLowerCase().includes(part.toLocaleLowerCase()))).join(', ') || undefined;
};

const normalizeResponses = (value: unknown): SpondEventSnapshot['responses'] => {
  const responses = asRecord(value);
  const knownLists = new Set(['acceptedIds', 'declinedIds', 'unansweredIds', 'waitinglistIds', 'unconfirmedIds']);
  if (Object.keys(responses).some(key => key.endsWith('Ids') && !knownLists.has(key))) {
    throw new SpondProxyError('SPOND_UNKNOWN_RESPONSE_LIST', 502);
  }

  const lists = [
    ['acceptedIds', 'accepted'],
    ['declinedIds', 'declined'],
    ['unansweredIds', 'open'],
    ['waitinglistIds', 'open'],
    ['unconfirmedIds', 'open']
  ] as const;
  const byMember = new Map<string, 'open' | 'accepted' | 'declined'>();
  for (const [field, response] of lists) {
    const ids = stringArray(responses[field]);
    if (!ids) continue;
    for (const id of ids) {
      const previous = byMember.get(id);
      if (previous && previous !== response) {
        throw new SpondProxyError('SPOND_CONFLICTING_RESPONSES', 502);
      }
      byMember.set(id, response);
    }
  }
  return Array.from(byMember, ([spondMemberId, response]) => ({ spondMemberId, response }));
};

const normalizeEvent = (value: unknown, expectedGroupId: string): SpondEventSnapshot => {
  const event = asRecord(value);
  const recipients = asRecord(event.recipients);
  const groupId = requiredString(asRecord(recipients.group).id);
  if (groupId !== expectedGroupId) throw new SpondProxyError('SPOND_GROUP_MISMATCH', 502);
  const sourceStartsAt = requiredString(event.startTimestamp);
  const sourceEndsAt = optionalString(event.endTimestamp);
  if (Number.isNaN(Date.parse(sourceStartsAt)) || (sourceEndsAt && (Number.isNaN(Date.parse(sourceEndsAt)) || Date.parse(sourceEndsAt) < Date.parse(sourceStartsAt)))) {
    throw new SpondProxyError('SPOND_INVALID_TIMESTAMP', 502);
  }
  const startsAt = toAppWallClock(sourceStartsAt);
  const endsAt = sourceEndsAt ? toAppWallClock(sourceEndsAt) : undefined;
  return {
    id: requiredString(event.id),
    groupId,
    name: requiredString(event.heading),
    startsAt,
    endsAt,
    location: normalizeLocation(event.location),
    responses: normalizeResponses(event.responses)
  };
};

const readJson = async (response: Response): Promise<unknown> => {
  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (declaredSize > MAX_RESPONSE_BYTES) throw new SpondProxyError('SPOND_RESPONSE_TOO_LARGE', 502);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new SpondProxyError('SPOND_RESPONSE_TOO_LARGE', 502);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  }
};

const requestJson = async (url: URL, init: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  const target = `${init.method ?? 'GET'} ${url.pathname}`;
  try {
    console.log(`[spond] -> ${target}`);
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    console.log(`[spond] <- ${target} status=${response.status} durationMs=${Date.now() - startedAt}`);
    if (!response.ok) {
      // Only a truncated error body is logged; success bodies may contain tokens/personal data
      const errorBody = await response.text().catch(() => '');
      console.warn(`[spond] error response ${target} status=${response.status} body=${errorBody.replace(/\s+/g, ' ').slice(0, 300)}`);
      if (response.status === 401) throw new SpondProxyError('SPOND_AUTH_FAILED', 401);
      if (response.status === 403) throw new SpondProxyError('SPOND_ACCESS_DENIED', 403);
      if (response.status === 429) throw new SpondProxyError('SPOND_RATE_LIMITED', 429);
      throw new SpondProxyError('SPOND_REQUEST_FAILED', 502);
    }
    return await readJson(response);
  } catch (error) {
    if (error instanceof SpondProxyError) throw error;
    console.error(
      `[spond] failed ${target} durationMs=${Date.now() - startedAt} error=${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'}`
    );
    throw new SpondProxyError(error instanceof Error && error.name === 'AbortError' ? 'SPOND_TIMEOUT' : 'SPOND_REQUEST_FAILED', 502);
  } finally {
    clearTimeout(timeout);
  }
};

const login = async (email: string, password: string): Promise<string> => {
  const body = await requestJson(new URL(`${SPOND_API_URL}/auth2/login`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const accessToken = asRecord(asRecord(body).accessToken);
  try {
    return requiredString(accessToken.token);
  } catch {
    throw new SpondProxyError('SPOND_AUTH_FAILED', 401);
  }
};

const get = (path: string, token: string, params?: URLSearchParams): Promise<unknown> => {
  const url = new URL(`${SPOND_API_URL}${path}`);
  if (params) url.search = params.toString();
  return requestJson(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
};

const getGroups = async (token: string): Promise<SpondSnapshot['group'][]> => {
  const value = await get('/groups', token);
  if (!Array.isArray(value)) throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  return value.map(normalizeGroup);
};

const getEvents = async (
  token: string,
  groupId: string,
  from: string,
  to: string,
  depth = 0
): Promise<SpondEventSnapshot[]> => {
  const params = new URLSearchParams({
    groupId,
    minStartTimestamp: from,
    maxStartTimestamp: to,
    max: String(MAX_EVENTS_PER_REQUEST),
    order: 'asc',
    scheduled: 'false',
    includeHidden: 'false',
    includeComments: 'false',
    addProfileInfo: 'false'
  });
  const value = await get('/sponds', token, params);
  if (!Array.isArray(value)) throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  if (value.length < MAX_EVENTS_PER_REQUEST) return value.map(event => normalizeEvent(event, groupId));
  if (depth >= MAX_SPLIT_DEPTH) throw new SpondProxyError('SPOND_INCOMPLETE_RESULTS', 502);

  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  const middle = Math.floor((fromTime + toTime) / 2);
  if (!Number.isFinite(middle) || middle <= fromTime || middle >= toTime) {
    throw new SpondProxyError('SPOND_INCOMPLETE_RESULTS', 502);
  }
  const middleIso = new Date(middle).toISOString();
  const [left, right] = await Promise.all([
    getEvents(token, groupId, from, middleIso, depth + 1),
    getEvents(token, groupId, middleIso, to, depth + 1)
  ]);
  return Array.from(new Map([...left, ...right].map(event => [event.id, event])).values())
    .filter(event => Date.parse(event.startsAt) >= fromTime && Date.parse(event.startsAt) < toTime);
};

export const listSpondGroups = async (email: string, password: string): Promise<SpondGroupSummary[]> => {
  const token = await login(email, password);
  const groups = await getGroups(token);
  return groups.map(({ id, name }) => ({ id, name }));
};

export const readSpondSnapshot = async (
  email: string,
  password: string,
  groupId: string,
  from: string,
  to: string
): Promise<SpondSnapshot> => {
  const token = await login(email, password);
  const groups = await getGroups(token);
  const group = groups.find(candidate => candidate.id === groupId);
  if (!group) throw new SpondProxyError('SPOND_GROUP_NOT_FOUND', 404);
  const events = await getEvents(token, groupId, from, to);
  return { group, events, sourceReadAt: new Date().toISOString() };
};
