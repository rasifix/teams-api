const SPOND_API_URL = 'https://api.spond.com/core/v1';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS_PER_REQUEST = 100;
const MAX_SPLIT_DEPTH = 12;
const DEFAULT_SPOND_TIME_ZONE = 'Europe/Zurich';

type UnknownRecord = Record<string, unknown>;

export interface SpondSubGroupSummary {
  id: string;
  name: string;
  color?: string;
}

export interface SpondGroupSummary {
  id: string;
  name: string;
  subGroups?: SpondSubGroupSummary[];
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
  email?: string;
  birthDate?: string;
  guardians: SpondGuardianSnapshot[];
  roles: string[];
  subGroups?: string[];
}

export interface SpondEventSnapshot {
  id: string;
  groupId: string;
  type: string;
  matchEvent?: boolean;
  status: 'active' | 'cancelled' | 'deleted';
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
  activities: SpondEventSnapshot[];
  sourceReadAt: string;
}

export class SpondProxyError extends Error {
  public readonly cause?: unknown;

  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details?: string,
    cause?: unknown
  ) {
    const message = details ? `${code}: ${details}` : code;
    super(message);
    this.name = 'SpondProxyError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

const asRecord = (value: unknown, context?: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SpondProxyError(
      'SPOND_INVALID_RESPONSE',
      502,
      context ? `Expected object record for ${context}, received ${Array.isArray(value) ? 'array' : typeof value}` : `Expected object record, received ${Array.isArray(value) ? 'array' : typeof value}`
    );
  }
  return value as UnknownRecord;
};

const requiredString = (value: unknown, context?: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SpondProxyError(
      'SPOND_INVALID_RESPONSE',
      502,
      context ? `Expected non-empty string for ${context}, received ${JSON.stringify(value)}` : `Expected non-empty string, received ${JSON.stringify(value)}`
    );
  }
  return value.trim();
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const wallClockParts = (instant: Date, timeZone: string): Record<string, string> => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
};

const timeZoneOffsetMs = (instantMs: number, timeZone: string): number => {
  const roundedInstantMs = Math.trunc(instantMs / 1000) * 1000;
  const parts = wallClockParts(new Date(roundedInstantMs), timeZone);
  const wallClockAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return wallClockAsUtc - roundedInstantMs;
};

/** Normalize a Spond timestamp to a UTC instant.
 *
 * Offset-bearing timestamps already identify an instant and must never be
 * shifted to a second, artificial wall-clock instant. Offset-less timestamps
 * are interpreted in the source timezone (Europe/Zurich by default).
 */
const toUtcIso = (value: string, sourceTimeZone: string): string => {
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) throw new SpondProxyError('SPOND_INVALID_TIMESTAMP', 502);
    return instant.toISOString();
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) throw new SpondProxyError('SPOND_INVALID_TIMESTAMP', 502);
  const [, year, month, day, hour, minute, second = '00', fraction = '0'] = match;
  const millisecond = Number(fraction.padEnd(3, '0'));
  const wallClockUtcMs = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second), millisecond
  );

  let instantMs = wallClockUtcMs;
  try {
    // Re-evaluate because the UTC offset can differ at the initial estimate
    // around daylight-saving transitions.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      instantMs = wallClockUtcMs - timeZoneOffsetMs(instantMs, sourceTimeZone);
    }
    const actual = wallClockParts(new Date(instantMs), sourceTimeZone);
    if (actual.year !== year || actual.month !== month || actual.day !== day
      || actual.hour !== hour || actual.minute !== minute || actual.second !== second) {
      throw new Error('Non-existent local time');
    }
  } catch {
    throw new SpondProxyError('SPOND_INVALID_TIMESTAMP', 502);
  }
  return new Date(instantMs).toISOString();
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

const stringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  }
  return value as string[];
};

const normalizeGuardian = (value: unknown): SpondGuardianSnapshot => {
  const guardian = asRecord(value, 'guardian');
  const profile = guardian.profile && typeof guardian.profile === 'object' && !Array.isArray(guardian.profile)
    ? asRecord(guardian.profile, 'guardian.profile')
    : {};
  const id = optionalString(guardian.id) ?? optionalString(profile.id);
  let firstName = optionalString(guardian.firstName) ?? optionalString(profile.firstName);
  let lastName = optionalString(guardian.lastName) ?? optionalString(profile.lastName);
  if (!firstName || !lastName) {
    const fullName = optionalString(guardian.name) ?? optionalString(profile.name);
    if (fullName) {
      const spaceIdx = fullName.indexOf(' ');
      if (spaceIdx > 0) {
        firstName = firstName ?? fullName.slice(0, spaceIdx).trim();
        lastName = lastName ?? fullName.slice(spaceIdx + 1).trim();
      } else {
        firstName = firstName ?? fullName;
        lastName = lastName ?? '-';
      }
    }
  }
  if (!id || !firstName || !lastName) {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502, `Guardian ${id ?? 'unknown'} missing required name fields`);
  }
  return {
    id,
    firstName,
    lastName,
    email: optionalString(guardian.email) ?? optionalString(profile.email)
  };
};

const extractMemberSubGroupIds = (value: unknown): string[] => {
  if (!value || !Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const id = optionalString((entry as UnknownRecord).id);
      if (id) return [id];
    }
    return [];
  });
};

interface SpondInternalMember extends SpondMemberSnapshot {
  subGroupIds: string[];
}

const normalizeMember = (value: unknown, rolesById: Map<string, string>): SpondInternalMember => {
  const member = asRecord(value, 'member');
  const rawGuardians = member.guardians ?? [];
  if (!Array.isArray(rawGuardians)) {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502, `Member ${member.id ?? 'unknown'} guardians is not an array`);
  }
  const profile = member.profile && typeof member.profile === 'object' && !Array.isArray(member.profile)
    ? asRecord(member.profile, 'member.profile')
    : {};
  const id = optionalString(member.id) ?? optionalString(profile.id);
  let firstName = optionalString(member.firstName) ?? optionalString(profile.firstName);
  let lastName = optionalString(member.lastName) ?? optionalString(profile.lastName);
  if (!firstName || !lastName) {
    const fullName = optionalString(member.name) ?? optionalString(profile.name);
    if (fullName) {
      const spaceIdx = fullName.indexOf(' ');
      if (spaceIdx > 0) {
        firstName = firstName ?? fullName.slice(0, spaceIdx).trim();
        lastName = lastName ?? fullName.slice(spaceIdx + 1).trim();
      } else {
        firstName = firstName ?? fullName;
        lastName = lastName ?? '-';
      }
    }
  }
  if (!id || !firstName || !lastName) {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502, `Member ${id ?? 'unknown'} missing required name fields`);
  }

  const subGroupIds = Array.from(new Set([
    ...extractMemberSubGroupIds(member.subGroups),
    ...extractMemberSubGroupIds(member.subGroupIds),
    ...extractMemberSubGroupIds(profile.subGroups),
    ...extractMemberSubGroupIds(profile.subGroupIds)
  ]));

  return {
    id,
    firstName,
    lastName,
    email: optionalString(member.email) ?? optionalString(profile.email),
    birthDate: optionalString(member.dateOfBirth) ?? optionalString(member.birthDate) ?? optionalString(profile.dateOfBirth) ?? optionalString(profile.birthDate),
    guardians: rawGuardians.flatMap(g => {
      try {
        return [normalizeGuardian(g)];
      } catch (err) {
        console.warn(`[spond] skipping invalid guardian in member ${id}:`, err);
        return [];
      }
    }),
    roles: roleNames(member.roles).map(role => rolesById.get(role) ?? role),
    subGroupIds,
    ...(subGroupIds.length > 0 ? { subGroups: subGroupIds } : {})
  };
};

const normalizeSubGroup = (value: unknown): SpondSubGroupSummary => {
  if (typeof value === 'string' && value.trim()) {
    const id = value.trim();
    return { id, name: id };
  }
  const subGroup = asRecord(value, 'subGroup');
  const id = requiredString(subGroup.id, 'subGroup.id');
  const name = optionalString(subGroup.name)
    ?? optionalString(subGroup.title)
    ?? optionalString(subGroup.heading)
    ?? id;
  return {
    id,
    name,
    color: optionalString(subGroup.color)
  };
};

const normalizeSubGroups = (value: unknown): SpondSubGroupSummary[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    console.warn('[spond] expected subGroups to be an array, got:', typeof value);
    return undefined;
  }
  const subGroups: SpondSubGroupSummary[] = [];
  for (const item of value) {
    try {
      subGroups.push(normalizeSubGroup(item));
    } catch (err) {
      console.warn('[spond] skipping invalid subgroup:', err);
    }
  }
  return subGroups.length > 0 ? subGroups : undefined;
};

interface SpondInternalGroup {
  id: string;
  name: string;
  subGroups?: SpondSubGroupSummary[];
  members: SpondInternalMember[];
}

const normalizeGroup = (value: unknown): SpondInternalGroup => {
  const group = asRecord(value, 'group');
  if (!Array.isArray(group.members) && group.members !== undefined && group.members !== null) {
    throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502, `Group ${group.id ?? 'unknown'} members is not an array`);
  }
  const administrators = adminIds(group);
  const rolesById = roleLookup(group);
  const subGroups = normalizeSubGroups(group.subGroups);
  const rawMembers = Array.isArray(group.members) ? group.members : [];
  return {
    id: requiredString(group.id, 'group.id'),
    name: requiredString(group.name, 'group.name'),
    subGroups,
    members: rawMembers
      .map(member => normalizeMember(member, rolesById))
      .filter(member => !administrators.has(member.id))
  };
};

const normalizeLocation = (value: unknown): string | undefined => {
  if (typeof value === 'string') return optionalString(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const location = asRecord(value);
  const parts = [optionalString(location.name), optionalString(location.feature), optionalString(location.address)]
    .filter((part): part is string => Boolean(part));
  return parts.filter((part, index) => !parts.some((other, otherIndex) => otherIndex < index && other.toLocaleLowerCase().includes(part.toLocaleLowerCase()))).join(', ') || undefined;
};

const normalizeResponses = (value: unknown): SpondEventSnapshot['responses'] => {
  if (value === undefined || value === null) return [];
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

const extractEventRecipients = (event: UnknownRecord): { groupId?: string; subGroupIds: string[] } => {
  let groupId: string | undefined = optionalString(event.groupId) ?? optionalString(event.spondGroupId);
  const subGroupIds: string[] = [];

  if (event.recipients && typeof event.recipients === 'object' && !Array.isArray(event.recipients)) {
    const recipients = event.recipients as UnknownRecord;
    if (recipients.group && typeof recipients.group === 'object' && !Array.isArray(recipients.group)) {
      const groupObj = recipients.group as UnknownRecord;
      groupId = optionalString(groupObj.id) ?? groupId;
      if (Array.isArray(groupObj.subGroups)) {
        for (const sg of groupObj.subGroups) {
          if (typeof sg === 'string' && sg.trim()) subGroupIds.push(sg.trim());
          else if (sg && typeof sg === 'object' && !Array.isArray(sg)) {
            const id = optionalString((sg as UnknownRecord).id);
            if (id) subGroupIds.push(id);
          }
        }
      }
    } else if (typeof recipients.groupId === 'string') {
      groupId = optionalString(recipients.groupId) ?? groupId;
    }

    if (Array.isArray(recipients.subGroups)) {
      for (const sg of recipients.subGroups) {
        if (typeof sg === 'string' && sg.trim()) subGroupIds.push(sg.trim());
        else if (sg && typeof sg === 'object' && !Array.isArray(sg)) {
          const id = optionalString((sg as UnknownRecord).id);
          if (id) subGroupIds.push(id);
        }
      }
    }
  }

  return { groupId, subGroupIds };
};

const eventMatchesSubGroup = (event: unknown, subGroupId?: string): boolean => {
  if (!subGroupId) return true;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const { subGroupIds } = extractEventRecipients(event as UnknownRecord);
  if (subGroupIds.length === 0) return true;
  return subGroupIds.includes(subGroupId);
};

const normalizeSpondActivityStatus = (event: UnknownRecord): 'active' | 'cancelled' | 'deleted' => {
  const raw = optionalString(event.status) ?? optionalString(event.activityStatus) ?? optionalString(event.eventStatus);
  if (raw?.toLocaleLowerCase() === 'deleted' || event.deleted === true || event.isDeleted === true) return 'deleted';
  if (raw?.toLocaleLowerCase() === 'cancelled' || raw?.toLocaleLowerCase() === 'canceled'
    || event.cancelled === true || event.canceled === true || event.isCancelled === true || event.isCanceled === true) {
    return 'cancelled';
  }
  return 'active';
};

const normalizeEvent = (
  value: unknown,
  parentGroupId: string,
  targetGroupId: string
): SpondEventSnapshot => {
  const event = asRecord(value);
  const type = requiredString(event.type, 'event.type');
  const { groupId: eventGroupId } = extractEventRecipients(event);
  if (eventGroupId && eventGroupId !== parentGroupId && eventGroupId !== targetGroupId) {
    throw new SpondProxyError('SPOND_GROUP_MISMATCH', 502);
  }
  const sourceStartsAt = optionalString(event.startTimestamp) ?? optionalString(event.startTime);
  if (!sourceStartsAt) throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  const sourceEndsAt = optionalString(event.endTimestamp) ?? optionalString(event.endTime);
  const sourceTimeZone = optionalString(event.timeZone) ?? optionalString(event.timezone) ?? DEFAULT_SPOND_TIME_ZONE;
  const startsAt = toUtcIso(sourceStartsAt, sourceTimeZone);
  const endsAt = sourceEndsAt ? toUtcIso(sourceEndsAt, sourceTimeZone) : undefined;
  if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
    throw new SpondProxyError('SPOND_INVALID_TIMESTAMP', 502);
  }
  const heading = optionalString(event.heading) ?? optionalString(event.name) ?? optionalString(event.title);
  if (!heading) throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  return {
    id: requiredString(event.id),
    groupId: targetGroupId,
    type,
    ...(typeof event.matchEvent === 'boolean' ? { matchEvent: event.matchEvent } : {}),
    status: normalizeSpondActivityStatus(event),
    name: heading,
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

const getGroups = async (token: string): Promise<SpondInternalGroup[]> => {
  const value = await get('/groups', token);
  if (!Array.isArray(value)) {
    const err = new SpondProxyError('SPOND_INVALID_RESPONSE', 502, `Expected /groups response to be array, got ${typeof value}`);
    console.error('[spond] getGroups invalid response:', err.message);
    throw err;
  }
  return value.map((entry, index) => {
    try {
      return normalizeGroup(entry);
    } catch (err) {
      console.error(`[spond] failed to normalize group at index ${index}:`, err);
      throw err;
    }
  });
};

const getEvents = async (
  token: string,
  parentGroupId: string,
  from: string,
  to: string,
  subGroupId?: string,
  depth = 0
): Promise<SpondEventSnapshot[]> => {
  const params = new URLSearchParams({
    groupId: parentGroupId,
    minStartTimestamp: from,
    maxStartTimestamp: to,
    max: String(MAX_EVENTS_PER_REQUEST),
    order: 'asc',
    scheduled: 'false',
    includeHidden: 'false',
    includeComments: 'false',
    addProfileInfo: 'false'
  });
  if (subGroupId) {
    params.set('subGroupId', subGroupId);
  }
  const value = await get('/sponds', token, params);
  if (!Array.isArray(value)) throw new SpondProxyError('SPOND_INVALID_RESPONSE', 502);
  value.forEach((event, index) => {
    console.log(`[spond] raw activity[${index}] ${JSON.stringify(event)}`);
  });
  const targetGroupId = subGroupId ?? parentGroupId;
  if (value.length < MAX_EVENTS_PER_REQUEST) {
    return value
      .filter(event => eventMatchesSubGroup(event, subGroupId))
      .map(event => normalizeEvent(event, parentGroupId, targetGroupId));
  }
  if (depth >= MAX_SPLIT_DEPTH) throw new SpondProxyError('SPOND_INCOMPLETE_RESULTS', 502);

  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  const middle = Math.floor((fromTime + toTime) / 2);
  if (!Number.isFinite(middle) || middle <= fromTime || middle >= toTime) {
    throw new SpondProxyError('SPOND_INCOMPLETE_RESULTS', 502);
  }
  const middleIso = new Date(middle).toISOString();
  const [left, right] = await Promise.all([
    getEvents(token, parentGroupId, from, middleIso, subGroupId, depth + 1),
    getEvents(token, parentGroupId, middleIso, to, subGroupId, depth + 1)
  ]);
  return Array.from(new Map([...left, ...right].map(event => [event.id, event])).values())
    .filter(event => Date.parse(event.startsAt) >= fromTime && Date.parse(event.startsAt) < toTime);
};

export const listSpondGroups = async (email: string, password: string): Promise<SpondGroupSummary[]> => {
  try {
    const token = await login(email, password);
    const groups = await getGroups(token);
    return groups.map(({ id, name, subGroups }) => ({
      id,
      name,
      ...(subGroups && subGroups.length > 0 ? { subGroups } : {})
    }));
  } catch (error) {
    console.error('[spond] listSpondGroups failed:', error);
    throw error;
  }
};

export const readSpondSnapshot = async (
  email: string,
  password: string,
  groupId: string,
  from: string,
  to: string,
  subGroupId?: string
): Promise<SpondSnapshot> => {
  try {
    const token = await login(email, password);
    const groups = await getGroups(token);

    let parentGroup: SpondInternalGroup | undefined;
    let targetSubGroup: SpondSubGroupSummary | undefined;

    if (subGroupId) {
      parentGroup = groups.find(candidate => candidate.id === groupId);
      if (!parentGroup) throw new SpondProxyError('SPOND_GROUP_NOT_FOUND', 404, `Parent group ${groupId} not found`);
      targetSubGroup = parentGroup.subGroups?.find(candidate => candidate.id === subGroupId);
      if (!targetSubGroup) throw new SpondProxyError('SPOND_GROUP_NOT_FOUND', 404, `Subgroup ${subGroupId} not found in group ${groupId}`);
    } else {
      parentGroup = groups.find(candidate => candidate.id === groupId);
      if (!parentGroup) {
        for (const group of groups) {
          const found = group.subGroups?.find(candidate => candidate.id === groupId);
          if (found) {
            parentGroup = group;
            targetSubGroup = found;
            break;
          }
        }
      }
    }

    if (!parentGroup) throw new SpondProxyError('SPOND_GROUP_NOT_FOUND', 404, `Group or subgroup ${groupId} not found`);

    const resolvedSubGroupId = targetSubGroup?.id;
    const activities = await getEvents(token, parentGroup.id, from, to, resolvedSubGroupId);

    const snapshotGroup = targetSubGroup
      ? {
          id: targetSubGroup.id,
          name: targetSubGroup.name,
          members: parentGroup.members
            .filter(member => member.subGroupIds.includes(targetSubGroup!.id))
            .map(({ subGroupIds, ...member }) => member)
        }
      : {
          id: parentGroup.id,
          name: parentGroup.name,
          ...(parentGroup.subGroups && parentGroup.subGroups.length > 0 ? { subGroups: parentGroup.subGroups } : {}),
          members: parentGroup.members.map(({ subGroupIds, ...member }) => member)
        };

    return { group: snapshotGroup, activities, sourceReadAt: new Date().toISOString() };
  } catch (error) {
    console.error(`[spond] readSpondSnapshot failed (groupId=${groupId}, subGroupId=${subGroupId}):`, error);
    throw error;
  }
};
