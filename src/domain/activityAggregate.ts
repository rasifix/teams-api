import type {
  Activity,
  ActivityAttendance,
  ActivityInvitation,
  Team
} from '../types';
import type {
  ActivityDomainEvent,
  ActivityEvent,
  ActivityEventPayloads
} from '../types/activityEvents';

export interface ActivityReplayResult {
  activity: Activity | null;
  deleted: boolean;
  revision: number;
}

export interface ActivityReplayCheckpoint {
  activity: Activity | null;
  deleted: boolean;
  revision: number;
}

export class ActivityReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityReplayError';
  }
}

export class UnsupportedActivityEventError extends ActivityReplayError {
  constructor(type: string) {
    super(`Activity event type is not supported by the current aggregate: ${type}`);
    this.name = 'UnsupportedActivityEventError';
  }
}

export function replayActivityEvents(
  commits: ActivityEvent[],
  checkpoint?: ActivityReplayCheckpoint
): ActivityReplayResult {
  const orderedCommits = [...commits].sort((left, right) => left.revision - right.revision);
  let activity: Activity | null = checkpoint?.activity ?? null;
  let deleted = checkpoint?.deleted ?? false;
  let expectedRevision = (checkpoint?.revision ?? 0) + 1;

  for (const commit of orderedCommits) {
    if (commit.revision !== expectedRevision) {
      throw new ActivityReplayError(
        `Activity stream has a revision gap: expected ${expectedRevision}, got ${commit.revision}`
      );
    }
    expectedRevision += 1;

    const events = [...commit.events].sort((left, right) => left.ordinal - right.ordinal);
    events.forEach((event, index) => {
      if (event.ordinal !== index) {
        throw new ActivityReplayError(
          `Activity commit ${commit._id} has an event ordinal gap at ${event.ordinal}`
        );
      }
      const result = applyActivityEvent(activity, deleted, event as ActivityDomainEvent);
      activity = result.activity;
      deleted = result.deleted;
    });
  }

  return {
    activity,
    deleted,
    revision: orderedCommits.length === 0
      ? checkpoint?.revision ?? 0
      : orderedCommits[orderedCommits.length - 1].revision
  };
}

function applyActivityEvent(
  activity: Activity | null,
  deleted: boolean,
  event: ActivityDomainEvent
): { activity: Activity | null; deleted: boolean } {
  if (event.type === 'ActivityCreated' || event.type === 'ActivityImported') {
    if (activity || deleted) {
      throw new ActivityReplayError(`${event.type} cannot be applied to an existing Activity`);
    }
    return { activity: cloneActivity(event.data), deleted: false };
  }

  if (event.type === 'ActivityDeleted') {
    if (!activity || deleted) {
      throw new ActivityReplayError('ActivityDeleted requires an existing Activity');
    }
    return { activity: null, deleted: true };
  }

  if (!activity || deleted) {
    throw new ActivityReplayError(`${event.type} requires an active Activity state`);
  }

  switch (event.type) {
    case 'ActivityDetailsChanged':
      return { activity: { ...activity, ...event.data }, deleted: false };
    case 'InvitationAdded':
      return { activity: addInvitation(activity, event.data), deleted: false };
    case 'InvitationRemoved':
      return { activity: removeInvitation(activity, event.data.invitationId), deleted: false };
    case 'InvitationResponseChanged':
      return { activity: changeInvitationResponse(activity, event.data), deleted: false };
    case 'TeamAdded':
      return { activity: addTeam(activity, event.data), deleted: false };
    case 'TeamChanged':
      return { activity: changeTeam(activity, event.data), deleted: false };
    case 'TeamRemoved':
      return { activity: removeTeam(activity, event.data.teamId), deleted: false };
    case 'PlayerSelected':
      return { activity: selectPlayer(activity, event.data.teamId, event.data.playerId), deleted: false };
    case 'PlayerUnselected':
      return { activity: unselectPlayer(activity, event.data.teamId, event.data.playerId), deleted: false };
    case 'LineupChanged':
      return { activity: changeLineup(activity, event.data.teamId, event.data.lineup), deleted: false };
    case 'SelectionPublished':
      return { activity: { ...activity, selectionSentAt: event.data.selectionSentAt }, deleted: false };
    case 'AttendanceRecorded':
      return { activity: recordAttendance(activity, event.data), deleted: false };
    case 'AttendanceRemoved':
      return { activity: removeAttendance(activity, event.data.personId), deleted: false };
    case 'TaskCreated':
    case 'TaskChanged':
    case 'TaskDeleted':
    case 'TaskSignupAdded':
    case 'TaskSignupRemoved':
    case 'TrainingPlanChanged':
      throw new UnsupportedActivityEventError(event.type);
  }
}

function cloneActivity(activity: Activity): Activity {
  return {
    ...activity,
    teams: activity.teams.map(team => ({
      ...team,
      selectedPlayers: [...team.selectedPlayers],
      lineup: team.lineup?.map(period => ({
        ...period,
        assignments: period.assignments.map(assignment => ({ ...assignment }))
      }))
    })),
    invitations: activity.invitations.map(invitation => ({ ...invitation })),
    attendance: activity.attendance?.map(record => ({ ...record }))
  };
}

function addInvitation(activity: Activity, invitation: ActivityInvitation): Activity {
  if (activity.invitations.some(item => item.id === invitation.id)) {
    throw new ActivityReplayError(`Invitation already exists: ${invitation.id}`);
  }
  return { ...activity, invitations: [...activity.invitations, { ...invitation }] };
}

function removeInvitation(activity: Activity, invitationId: string): Activity {
  if (!activity.invitations.some(item => item.id === invitationId)) {
    throw new ActivityReplayError(`Invitation not found: ${invitationId}`);
  }
  return { ...activity, invitations: activity.invitations.filter(item => item.id !== invitationId) };
}

function changeInvitationResponse(
  activity: Activity,
  data: ActivityEventPayloads['InvitationResponseChanged']
): Activity {
  let found = false;
  const invitations = activity.invitations.map(invitation => {
    if (invitation.id !== data.invitationId) return invitation;
    found = true;
    return {
      ...invitation,
      playerId: data.playerId,
      response: data.response,
      declineReason: data.declineReason,
      respondedBy: data.respondedBy
    };
  });
  if (!found) throw new ActivityReplayError(`Invitation not found: ${data.invitationId}`);
  return { ...activity, invitations };
}

function addTeam(activity: Activity, team: Team): Activity {
  if (activity.teams.some(item => item.id === team.id)) {
    throw new ActivityReplayError(`Team already exists: ${team.id}`);
  }
  return { ...activity, teams: [...activity.teams, cloneTeam(team)] };
}

function changeTeam(activity: Activity, team: Team): Activity {
  if (!activity.teams.some(item => item.id === team.id)) {
    throw new ActivityReplayError(`Team not found: ${team.id}`);
  }
  return { ...activity, teams: activity.teams.map(item => item.id === team.id ? cloneTeam(team) : item) };
}

function removeTeam(activity: Activity, teamId: string): Activity {
  if (!activity.teams.some(item => item.id === teamId)) {
    throw new ActivityReplayError(`Team not found: ${teamId}`);
  }
  return { ...activity, teams: activity.teams.filter(item => item.id !== teamId) };
}

function selectPlayer(activity: Activity, teamId: string, playerId: string): Activity {
  return updateTeamPlayers(activity, teamId, players => {
    if (players.includes(playerId)) throw new ActivityReplayError(`Player already selected: ${playerId}`);
    return [...players, playerId];
  });
}

function unselectPlayer(activity: Activity, teamId: string, playerId: string): Activity {
  return updateTeamPlayers(activity, teamId, players => {
    if (!players.includes(playerId)) throw new ActivityReplayError(`Player is not selected: ${playerId}`);
    return players.filter(id => id !== playerId);
  });
}

function updateTeamPlayers(
  activity: Activity,
  teamId: string,
  update: (players: string[]) => string[]
): Activity {
  let found = false;
  const teams = activity.teams.map(team => {
    if (team.id !== teamId) return team;
    found = true;
    return { ...team, selectedPlayers: update([...team.selectedPlayers]) };
  });
  if (!found) throw new ActivityReplayError(`Team not found: ${teamId}`);
  return { ...activity, teams };
}

function changeLineup(activity: Activity, teamId: string, lineup: Team['lineup']): Activity {
  let found = false;
  const teams = activity.teams.map(team => {
    if (team.id !== teamId) return team;
    found = true;
    return { ...team, lineup: lineup?.map(period => ({ ...period, assignments: period.assignments.map(assignment => ({ ...assignment })) })) };
  });
  if (!found) throw new ActivityReplayError(`Team not found: ${teamId}`);
  return { ...activity, teams };
}

function recordAttendance(activity: Activity, record: ActivityAttendance): Activity {
  const attendance = (activity.attendance ?? []).filter(item => item.personId !== record.personId);
  return { ...activity, attendance: [...attendance, { ...record }] };
}

function removeAttendance(activity: Activity, personId: string): Activity {
  return { ...activity, attendance: (activity.attendance ?? []).filter(item => item.personId !== personId) };
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
