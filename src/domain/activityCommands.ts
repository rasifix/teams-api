import type {
  Activity,
  ActivityAttendance,
  ActivityInvitation,
  Team
} from '../types';
import type {
  ActivityEventPayloads,
  ActivityEventType,
  DomainEvent
} from '../types/activityEvents';

export type ActivityCommand =
  | { type: 'CreateActivity'; activity: Activity }
  | { type: 'ImportActivity'; activity: Activity }
  | { type: 'UpdateActivity'; activity: Activity }
  | { type: 'DeleteActivity' }
  | { type: 'ChangeInvitationResponse'; invitation: ActivityInvitation }
  | { type: 'ReplaceTeams'; teams: Team[] }
  | { type: 'PublishSelection'; selectionSentAt: string }
  | { type: 'RecordAttendance'; attendance: ActivityAttendance }
  | { type: 'RemoveAttendance'; personId: string };

export class ActivityCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityCommandError';
  }
}

export function decideActivityCommand(
  current: Activity | null,
  command: ActivityCommand
): DomainEvent[] {
  const events = (() => {
    switch (command.type) {
      case 'CreateActivity':
        requireMissing(current, command.type);
        return [event('ActivityCreated', cloneActivity(command.activity))];
      case 'ImportActivity':
        requireMissing(current, command.type);
        return [event('ActivityImported', cloneActivity(command.activity))];
      case 'UpdateActivity':
        requireExisting(current, command.type);
        requireSameIdentity(current, command.activity);
        return diffActivity(current, command.activity);
      case 'DeleteActivity':
        requireExisting(current, command.type);
        return [event('ActivityDeleted', {})];
      case 'ChangeInvitationResponse':
        requireExisting(current, command.type);
        return decideInvitationResponse(current, command.invitation);
      case 'ReplaceTeams':
        requireExisting(current, command.type);
        return diffActivity(current, { ...current, teams: cloneTeams(command.teams) });
      case 'PublishSelection':
        requireExisting(current, command.type);
        if (current.selectionSentAt === command.selectionSentAt) return [];
        return [event('SelectionPublished', { selectionSentAt: command.selectionSentAt })];
      case 'RecordAttendance':
        requireExisting(current, command.type);
        return decideAttendance(current, command.attendance);
      case 'RemoveAttendance':
        requireExisting(current, command.type);
        if (!current.attendance?.some(item => item.personId === command.personId)) return [];
        return [event('AttendanceRemoved', { personId: command.personId })];
    }
  })();

  return events.map((item, ordinal) => ({ ...item, ordinal }));
}

function diffActivity(current: Activity, next: Activity): DomainEvent[] {
  const events: DomainEvent[] = [];
  const details: ActivityEventPayloads['ActivityDetailsChanged'] = {};

  const detailKeys: Array<keyof ActivityEventPayloads['ActivityDetailsChanged']> = [
    'spondId',
    'kind',
    'status',
    'name',
    'startsAt',
    'endsAt',
    'location',
    'matchFormatId',
    'opponentName',
    'maxPlayersPerTeam',
    'minPlayersPerTeam'
  ];
  for (const key of detailKeys) {
    if (!sameValue(current[key], next[key])) {
      (details as Record<string, unknown>)[key] = next[key];
    }
  }
  if (Object.keys(details).length > 0) {
    events.push(event('ActivityDetailsChanged', details));
  }

  events.push(...diffInvitations(current.invitations, next.invitations));
  events.push(...diffTeams(current.teams, next.teams));

  if (current.selectionSentAt !== next.selectionSentAt && next.selectionSentAt !== undefined) {
    events.push(event('SelectionPublished', { selectionSentAt: next.selectionSentAt }));
  }

  events.push(...diffAttendance(current.attendance ?? [], next.attendance ?? []));
  return events;
}

function diffInvitations(current: ActivityInvitation[], next: ActivityInvitation[]): DomainEvent[] {
  const events: DomainEvent[] = [];
  const currentById = new Map(current.map(invitation => [invitation.id, invitation]));
  const nextById = new Map(next.map(invitation => [invitation.id, invitation]));

  for (const invitation of current) {
    if (!nextById.has(invitation.id)) {
      events.push(event('InvitationRemoved', { invitationId: invitation.id }));
    }
  }
  for (const invitation of next) {
    const previous = currentById.get(invitation.id);
    if (!previous) {
      events.push(event('InvitationAdded', { ...invitation }));
    } else if (!sameValue(previous, invitation)) {
      events.push(event('InvitationResponseChanged', {
        invitationId: invitation.id,
        playerId: invitation.playerId,
        response: invitation.response,
        declineReason: invitation.declineReason,
        respondedBy: invitation.respondedBy
      }));
    }
  }
  return events;
}

function diffTeams(current: Team[], next: Team[]): DomainEvent[] {
  const events: DomainEvent[] = [];
  const currentById = new Map(current.map(team => [team.id, team]));
  const nextById = new Map(next.map(team => [team.id, team]));

  for (const team of current) {
    if (!nextById.has(team.id)) events.push(event('TeamRemoved', { teamId: team.id }));
  }
  for (const team of next) {
    const previous = currentById.get(team.id);
    if (!previous) {
      events.push(event('TeamAdded', cloneTeam(team)));
      continue;
    }

    const previousWithoutSelection = withoutTeamSelection(previous);
    const nextWithoutSelection = withoutTeamSelection(team);
    if (!sameValue(previousWithoutSelection, nextWithoutSelection)) {
      events.push(event('TeamChanged', {
        ...cloneTeam(team),
        selectedPlayers: [...previous.selectedPlayers],
        lineup: previous.lineup?.map(period => ({ ...period, assignments: period.assignments.map(assignment => ({ ...assignment })) }))
      }));
    }
    for (const playerId of team.selectedPlayers) {
      if (!previous.selectedPlayers.includes(playerId)) {
        events.push(event('PlayerSelected', { teamId: team.id, playerId }));
      }
    }
    for (const playerId of previous.selectedPlayers) {
      if (!team.selectedPlayers.includes(playerId)) {
        events.push(event('PlayerUnselected', { teamId: team.id, playerId }));
      }
    }
    if (!sameValue(previous.lineup, team.lineup)) {
      events.push(event('LineupChanged', {
        teamId: team.id,
        lineup: team.lineup?.map(period => ({ ...period, assignments: period.assignments.map(assignment => ({ ...assignment })) }))
      }));
    }
  }
  return events;
}

function decideInvitationResponse(current: Activity, invitation: ActivityInvitation): DomainEvent[] {
  const previous = current.invitations.find(item => item.id === invitation.id);
  if (!previous) throw new ActivityCommandError(`Invitation not found: ${invitation.id}`);
  if (sameValue(previous, invitation)) return [];
  return [event('InvitationResponseChanged', {
    invitationId: invitation.id,
    playerId: invitation.playerId,
    response: invitation.response,
    declineReason: invitation.declineReason,
    respondedBy: invitation.respondedBy
  })];
}

function decideAttendance(current: Activity, attendance: ActivityAttendance): DomainEvent[] {
  const previous = current.attendance?.find(item => item.personId === attendance.personId);
  if (previous && sameValue(previous, attendance)) return [];
  return [event('AttendanceRecorded', { ...attendance })];
}

function diffAttendance(current: ActivityAttendance[], next: ActivityAttendance[]): DomainEvent[] {
  const events: DomainEvent[] = [];
  const currentByPerson = new Map(current.map(record => [record.personId, record]));
  const nextByPerson = new Map(next.map(record => [record.personId, record]));
  for (const record of current) {
    if (!nextByPerson.has(record.personId)) events.push(event('AttendanceRemoved', { personId: record.personId }));
  }
  for (const record of next) {
    if (!sameValue(currentByPerson.get(record.personId), record)) {
      events.push(event('AttendanceRecorded', { ...record }));
    }
  }
  return events;
}

function event<TType extends ActivityEventType>(
  type: TType,
  data: ActivityEventPayloads[TType]
): DomainEvent<TType, ActivityEventPayloads[TType]> {
  return { ordinal: 0, type, schemaVersion: 1, data };
}

function requireExisting(activity: Activity | null, commandType: string): asserts activity is Activity {
  if (!activity) throw new ActivityCommandError(`${commandType} requires an existing Activity`);
}

function requireMissing(activity: Activity | null, commandType: string): void {
  if (activity) throw new ActivityCommandError(`${commandType} requires an empty Activity stream`);
}

function requireSameIdentity(current: Activity, next: Activity): void {
  if (current.id !== next.id || current.squadId !== next.squadId) {
    throw new ActivityCommandError('Activity identity cannot change');
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutTeamSelection(team: Team): Omit<Team, 'selectedPlayers' | 'lineup'> & { selectedPlayers?: never; lineup?: never } {
  const { selectedPlayers, lineup, ...details } = team;
  return details;
}

function cloneActivity(activity: Activity): Activity {
  return {
    ...activity,
    teams: cloneTeams(activity.teams),
    invitations: activity.invitations.map(invitation => ({ ...invitation })),
    attendance: activity.attendance?.map(record => ({ ...record }))
  };
}

function cloneTeams(teams: Team[]): Team[] {
  return teams.map(team => cloneTeam(team));
}

function cloneTeam(team: Team): Team {
  return {
    ...team,
    selectedPlayers: [...team.selectedPlayers],
    lineup: team.lineup?.map(period => ({
      ...period,
      assignments: period.assignments.map(assignment => ({ ...assignment }))
    }))
  };
}
