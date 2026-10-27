import type { Activity, Team } from '../types';
import type { ActivityEvent, ActivityDomainEvent } from '../types/activityEvents';
import { applyActivityEvent } from './activityAggregate';

export interface HistorySubject { type: 'activity' | 'team' | 'player' | 'person'; id: string; displayName: string | null }
export interface HistoryChange {
  type: string;
  subject: HistorySubject;
  field?: string;
  previous?: unknown;
  current?: unknown;
  context?: Record<string, unknown>;
}
export interface HistoryItem {
  id: string;
  revision: number;
  recordedAt: string;
  actor: { type: 'user' | 'system'; memberId: string | null; displayName: string | null };
  changes: HistoryChange[];
}

const activityFields = ['spondId', 'kind', 'status', 'name', 'startsAt', 'endsAt', 'location', 'opponentName', 'matchFormatId', 'minPlayersPerTeam', 'maxPlayersPerTeam'] as const;
const teamFields = ['name', 'strength', 'startTime', 'location', 'meetingTime', 'meetingLocation', 'responsiblePersonId', 'formationId', 'shirtSetId', 'shirtAssignments', 'status'] as const;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const value = (item: Record<string, unknown>, field: string): unknown => item[field] ?? null;

export function buildActivityHistory(
  commits: ActivityEvent[],
  names: ReadonlyMap<string, string> = new Map()
): { items: HistoryItem[] } {
  let activity: Activity | null = null;
  let deleted = false;
  const items: HistoryItem[] = [];
  for (const commit of [...commits].sort((a, b) => a.revision - b.revision)) {
    const changes: HistoryChange[] = [];
    for (const event of [...commit.events].sort((a, b) => a.ordinal - b.ordinal)) {
      const before = activity;
      let after: Activity | null = activity;
      if (event.schemaVersion !== 1 && !(event.type === 'AttendanceRecorded' && event.schemaVersion === 2)) {
        changes.push(fallback(event as ActivityDomainEvent, before, commit.aggregateId));
        continue;
      }
      try {
        const result = applyActivityEvent(activity, deleted, event as ActivityDomainEvent);
        after = result.activity;
        deleted = result.deleted;
      } catch {
        changes.push(fallback(event as ActivityDomainEvent, before, commit.aggregateId));
        continue;
      }
      changes.push(...describe(event as ActivityDomainEvent, before, after, commit.aggregateId, names));
      activity = after;
    }
    const memberId = commit.actor.memberId ?? null;
    items.push({
      id: commit._id, revision: commit.revision, recordedAt: commit.recordedAt,
      actor: { type: commit.actor.type, memberId, displayName: memberId ? names.get(memberId) ?? commit.actor.displayName ?? null : commit.actor.displayName ?? null },
      changes
    });
  }
  return { items: items.reverse() };
}

function fallback(event: ActivityDomainEvent, before: Activity | null, id: string): HistoryChange {
  return { type: 'event.unsupported', subject: { type: 'activity', id, displayName: before?.name ?? null }, context: { eventType: event.type, schemaVersion: event.schemaVersion } };
}

function describe(event: ActivityDomainEvent, before: Activity | null, after: Activity | null, id: string, names: ReadonlyMap<string, string>): HistoryChange[] {
  const activitySubject: HistorySubject = { type: 'activity', id, displayName: after?.name ?? before?.name ?? null };
  const data = event.data as Record<string, unknown>;
  const teamId = typeof data.teamId === 'string' ? data.teamId : typeof data.id === 'string' && event.type.startsWith('Team') ? data.id : '';
  const oldTeam = before?.teams.find(team => team.id === teamId);
  const newTeam = after?.teams.find(team => team.id === teamId);
  const teamSubject: HistorySubject = { type: 'team', id: teamId, displayName: newTeam?.name ?? oldTeam?.name ?? null };
  const playerId = typeof data.playerId === 'string' ? data.playerId : '';
  const playerSubject: HistorySubject = { type: 'player', id: playerId, displayName: names.get(playerId) ?? null };
  const fieldChanges = (fields: readonly string[], oldValue: Record<string, unknown>, newValue: Record<string, unknown>, type: string, subject: HistorySubject): HistoryChange[] =>
    fields.filter(field => !equal(value(oldValue, field), value(newValue, field))).map(field => ({ type, subject, field, previous: value(oldValue, field), current: value(newValue, field) }));
  switch (event.type) {
    case 'ActivityCreated': case 'ActivityImported': return [{ type: event.type === 'ActivityCreated' ? 'activity.created' : 'activity.imported', subject: activitySubject }];
    case 'ActivityDeleted': return [{ type: 'activity.deleted', subject: activitySubject }];
    case 'ActivityDetailsChanged': return fieldChanges(activityFields, (before ?? {}) as Record<string, unknown>, (after ?? {}) as Record<string, unknown>, 'activity.detailsChanged', activitySubject);
    case 'TeamAdded': return [{ type: 'team.added', subject: teamSubject }];
    case 'TeamRemoved': return [{ type: 'team.removed', subject: teamSubject }];
    case 'TeamChanged': return fieldChanges(teamFields, (oldTeam ?? {}) as Record<string, unknown>, (newTeam ?? {}) as Record<string, unknown>, 'team.detailsChanged', teamSubject);
    case 'InvitationAdded': return [{ type: 'invitation.added', subject: playerSubject, current: data.response }];
    case 'InvitationRemoved': {
      const invitation = before?.invitations.find(item => item.id === data.invitationId);
      return [{ type: 'invitation.removed', subject: { type: 'player', id: invitation?.playerId ?? '', displayName: names.get(invitation?.playerId ?? '') ?? null }, previous: invitation?.response }];
    }
    case 'InvitationResponseChanged': {
      const previous = before?.invitations.find(item => item.id === data.invitationId);
      return [{ type: 'invitation.responseChanged', subject: playerSubject, field: 'response', previous: previous?.response ?? null, current: data.response }];
    }
    case 'PlayerSelected': return [{ type: 'selection.playerAdded', subject: playerSubject, context: { teamId, teamName: teamSubject.displayName } }];
    case 'PlayerUnselected': return [{ type: 'selection.playerRemoved', subject: playerSubject, context: { teamId, teamName: teamSubject.displayName, ...(data.reason ? { reason: data.reason, removedAt: data.removedAt } : {}) } }];
    case 'LineupChanged': return [{ type: 'lineup.changed', subject: teamSubject, context: lineupContext(oldTeam, newTeam) }];
    case 'SelectionPublished': return [{ type: 'selection.markedSent', subject: activitySubject, current: data.selectionSentAt }];
    case 'AttendanceRecorded': {
      const personId = String(data.personId);
      const previous = before?.attendance?.find(item => item.personId === personId);
      const current = after?.attendance?.find(item => item.personId === personId);
      return fieldChanges(['status', 'reason'], (previous ?? {}) as Record<string, unknown>, (current ?? {}) as Record<string, unknown>, 'attendance.changed', { type: 'person', id: personId, displayName: names.get(personId) ?? null });
    }
    case 'AttendanceRemoved': {
      const personId = String(data.personId);
      return [{ type: 'attendance.removed', subject: { type: 'person', id: personId, displayName: names.get(personId) ?? null }, previous: before?.attendance?.find(item => item.personId === personId)?.status ?? null }];
    }
    default: return [fallback(event, before, id)];
  }
}

function lineupContext(before?: Team, after?: Team): Record<string, unknown> {
  const oldAssignments = before?.lineup?.flatMap(period => period.assignments.map(item => `${period.periodNumber}:${item.slotId}:${item.playerId}`)) ?? [];
  const newAssignments = after?.lineup?.flatMap(period => period.assignments.map(item => `${period.periodNumber}:${item.slotId}:${item.playerId}`)) ?? [];
  return { periods: [...new Set([...(before?.lineup ?? []), ...(after?.lineup ?? [])].map(item => item.periodNumber))].sort((a, b) => a - b), assignmentChanges: oldAssignments.filter(item => !newAssignments.includes(item)).length + newAssignments.filter(item => !oldAssignments.includes(item)).length };
}
