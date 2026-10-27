import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Activity, ActivityAttendance, ActivityInvitation, Team } from '../types';
import type { ActivityCommand } from '../domain/activityCommands';
import { ActivityCommandError, decideActivityCommand } from '../domain/activityCommands';
import { applyActivityEvent } from '../domain/activityAggregate';
import { dataStore } from '../data/store';
import { activityEventStore } from '../data/activityEventStore';
import { attendanceTimingError, selectionTimingError } from '../domain/activitySelectionPolicy';
import { handleActivityWriteError, setActivityEtag, validateTeams, writeContextFromRequest } from './activityController';

type Intent = 'details' | 'addTeam' | 'teamDetails' | 'responsible' | 'formation' | 'shirts' | 'lineup' | 'selection' | 'addInvitations' | 'removeInvitation' | 'attendance';
const keys = (body: unknown, allowed: string[], required: string[] = []): boolean =>
  Boolean(body) && typeof body === 'object' && !Array.isArray(body) &&
  Object.keys(body as object).every(key => allowed.includes(key)) && required.every(key => Object.prototype.hasOwnProperty.call(body, key));
const string = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nullableString = (value: unknown): boolean => value === null || string(value);
const time = (value: unknown): boolean => value === null || (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value));
const fail = (message: string): never => { throw new ActivityCommandError(message); };

async function buildCommand(intent: Intent, req: Request, activity: Activity): Promise<ActivityCommand> {
  const body = req.body as Record<string, any>;
  const idempotencyKey = typeof req.header === 'function' ? req.header('Idempotency-Key') : undefined;
  const retryKey = idempotencyKey && await activityEventStore.getByIdempotencyKey(activity.squadId, idempotencyKey) ? idempotencyKey : undefined;
  const team = activity.teams.find(item => item.id === req.params.teamId);
  if (['teamDetails', 'responsible', 'formation', 'shirts', 'lineup', 'selection'].includes(intent) && !team) fail('Team not found');
  switch (intent) {
    case 'details': {
      const allowed = ['kind', 'name', 'startsAt', 'endsAt', 'location', 'opponentName', 'matchFormatId', 'minPlayersPerTeam', 'maxPlayersPerTeam'];
      if (!keys(body, allowed) || Object.keys(body).length === 0) fail('Invalid Activity details');
      if (body.kind !== undefined && !['match', 'tournament'].includes(String(body.kind))) fail('Invalid kind');
      if (body.name !== undefined && !string(body.name)) fail('Invalid name');
      if (body.startsAt !== undefined && (typeof body.startsAt !== 'string' || Number.isNaN(Date.parse(body.startsAt)))) fail('Invalid startsAt');
      if (body.endsAt !== undefined && body.endsAt !== null && (typeof body.endsAt !== 'string' || Number.isNaN(Date.parse(body.endsAt)))) fail('Invalid endsAt');
      for (const field of ['location', 'opponentName', 'matchFormatId']) if (body[field] !== undefined && !nullableString(body[field])) fail(`Invalid ${field}`);
      for (const field of ['minPlayersPerTeam', 'maxPlayersPerTeam']) if (body[field] !== undefined && (!Number.isInteger(body[field]) || Number(body[field]) < 1)) fail(`Invalid ${field}`);
      const switchingToTournament = body.kind === 'tournament' && (
        activity.kind === 'match' || (activity.kind === 'tournament' && Boolean(retryKey))
      );
      if (activity.spondId && (
        ['name', 'startsAt', 'endsAt', 'location'].some(field => Object.prototype.hasOwnProperty.call(body, field)) ||
        (Object.prototype.hasOwnProperty.call(body, 'opponentName') && !(switchingToTournament && body.opponentName === null))
      )) fail('Spond-managed details cannot be changed');
      const changes = { ...body } as Partial<Activity>;
      for (const field of ['endsAt', 'location', 'opponentName', 'matchFormatId'] as const) if (changes[field] === null) (changes as Record<string, unknown>)[field] = undefined;
      if (changes.startsAt) changes.startsAt = new Date(changes.startsAt).toISOString();
      if (changes.endsAt) changes.endsAt = new Date(changes.endsAt).toISOString();
      const min = changes.minPlayersPerTeam ?? activity.minPlayersPerTeam ?? 1;
      const max = changes.maxPlayersPerTeam ?? activity.maxPlayersPerTeam ?? 1;
      if (min > max) fail('minPlayersPerTeam must not exceed maxPlayersPerTeam');
      if (changes.matchFormatId && !(await dataStore.getGroupPlayingModes(activity.squadId))?.some(item => item.id === changes.matchFormatId)) fail('Match format not found');
      if (changes.kind === 'match' && activity.kind === 'tournament' && activity.teams.length !== 1) fail('Activity kind is incompatible with current teams');
      return { type: 'PatchActivityDetails', changes };
    }
    case 'addTeam': {
      if (!keys(body, ['id', 'name', 'strength', 'startTime'], ['id', 'name']) || !string(body.id) || !string(body.name)) fail('Invalid team');
      if (activity.kind === 'match') fail('Match activities must have exactly one team');
      if (!retryKey && activity.teams.some(item => item.id === body.id)) fail('Team ID already exists');
      if (body.strength !== undefined && (![1, 2, 3].includes(Number(body.strength)))) fail('Invalid strength');
      if (body.startTime !== undefined && !time(body.startTime)) fail('Invalid startTime');
      return { type: 'AddTeam', team: { id: body.id, name: body.name, strength: Number(body.strength ?? 2), selectedPlayers: [], ...(body.startTime ? { startTime: body.startTime as string } : {}) } };
    }
    case 'teamDetails': {
      const allowed = ['name', 'strength', 'startTime', 'location', 'meetingTime', 'meetingLocation'];
      if (!keys(body, allowed) || Object.keys(body).length === 0) fail('Invalid team details');
      if (body.name !== undefined && !string(body.name)) fail('Invalid name');
      if (body.strength !== undefined && ![1, 2, 3].includes(Number(body.strength))) fail('Invalid strength');
      for (const field of ['startTime', 'meetingTime']) if (body[field] !== undefined && !time(body[field])) fail(`Invalid ${field}`);
      for (const field of ['location', 'meetingLocation']) if (body[field] !== undefined && !nullableString(body[field])) fail(`Invalid ${field}`);
      const changes = { ...body } as Partial<Team>;
      for (const field of ['startTime', 'location', 'meetingTime', 'meetingLocation']) if ((changes as Record<string, unknown>)[field] === null) (changes as Record<string, unknown>)[field] = undefined;
      return { type: 'PatchTeamDetails', teamId: team!.id, changes };
    }
    case 'responsible': {
      if (!keys(body, ['responsiblePersonId'], ['responsiblePersonId']) || !nullableString(body.responsiblePersonId)) fail('Invalid responsiblePersonId');
      if (body.responsiblePersonId === null && activity.selectionSentAt) fail('Responsible person is required after selection is marked sent');
      if (body.responsiblePersonId !== null && !(await dataStore.getGroupMemberIds(activity.squadId)).includes(body.responsiblePersonId as string)) fail('Responsible person is not a squad member');
      return { type: 'SetResponsiblePerson', teamId: team!.id, responsiblePersonId: body.responsiblePersonId as string | null };
    }
    case 'formation': {
      if (!keys(body, ['formationId'], ['formationId']) || !nullableString(body.formationId)) fail('Invalid formationId');
      const formation = body.formationId === null ? undefined : (await dataStore.getGroupFormations(activity.squadId))?.find(item => item.id === body.formationId);
      if (body.formationId !== null && !formation) fail('Formation not found');
      const format = (await dataStore.getGroupPlayingModes(activity.squadId))?.find(item => item.id === activity.matchFormatId);
      if (formation && format?.playersOnField && formation.slots.length !== format.playersOnField) fail('Formation is incompatible with match format');
      return { type: 'SetFormation', teamId: team!.id, formationId: body.formationId as string | null };
    }
    case 'shirts': {
      if (!keys(body, ['shirtSetId', 'assignments'], ['shirtSetId', 'assignments']) || !string(body.shirtSetId) || !Array.isArray(body.assignments)) fail('Invalid shirts');
      const shirtSet = await dataStore.getShirtSetById(body.shirtSetId);
      if (!shirtSet || shirtSet.groupId !== activity.squadId) throw new ActivityCommandError('Shirt set not found');
      const assignments = body.assignments as NonNullable<Team['shirtAssignments']>;
      if (!assignments.every(item => keys(item, ['playerId', 'shirtNumber'], ['playerId', 'shirtNumber']) && string(item.playerId) && Number.isInteger(item.shirtNumber) && team!.selectedPlayers.includes(item.playerId) && shirtSet.shirts.some(shirt => shirt.number === item.shirtNumber))) fail('Invalid shirt assignment');
      if (new Set(assignments.map(item => item.playerId)).size !== assignments.length || new Set(assignments.map(item => item.shirtNumber)).size !== assignments.length) fail('Shirt assignments must be unique');
      return { type: 'SetShirts', teamId: team!.id, shirtSetId: body.shirtSetId, assignments };
    }
    case 'lineup': {
      if (!keys(body, ['periods'], ['periods']) || !Array.isArray(body.periods) || activity.kind !== 'match') fail('Invalid lineup');
      const periods = body.periods as NonNullable<Team['lineup']>;
      const format = (await dataStore.getGroupPlayingModes(activity.squadId))?.find(item => item.id === activity.matchFormatId);
      const formation = (await dataStore.getGroupFormations(activity.squadId))?.find(item => item.id === team!.formationId);
      if (!format || !formation) throw new ActivityCommandError('Match format and formation are required');
      if (!periods.every(item => keys(item, ['periodNumber', 'assignments'], ['periodNumber', 'assignments']) && Number.isInteger(item.periodNumber) && item.periodNumber >= 1 && item.periodNumber <= format.numberOfPeriods && Array.isArray(item.assignments)) || new Set(periods.map(item => item.periodNumber)).size !== periods.length) fail('Invalid periods');
      for (const period of periods) {
        if (!period.assignments.every(item => keys(item, ['slotId', 'playerId'], ['slotId', 'playerId']) && string(item.slotId) && string(item.playerId) && formation.slots.some(slot => slot.id === item.slotId) && team!.selectedPlayers.includes(item.playerId)) || new Set(period.assignments.map(item => item.slotId)).size !== period.assignments.length || new Set(period.assignments.map(item => item.playerId)).size !== period.assignments.length) fail('Invalid lineup assignment');
      }
      return { type: 'SetLineup', teamId: team!.id, periods };
    }
    case 'selection': {
      if (!keys(body, ['add', 'remove'], ['add', 'remove']) || !Array.isArray(body.add) || !Array.isArray(body.remove)) fail('Invalid selection changes');
      const add = body.add as string[];
      const remove = body.remove as Array<{ playerId: string; reason?: string }>;
      if (!add.every(string) || !remove.every(item => keys(item, ['playerId', 'reason'], ['playerId']) && string(item.playerId) && (item.reason === undefined || string(item.reason)))) fail('Invalid selection changes');
      if (activity.selectionSentAt && remove.some(item => !string(item.reason))) fail('Removal reason is required after selection is marked sent');
      if (!activity.selectionSentAt && remove.some(item => item.reason !== undefined)) fail('Removal reason is only allowed after selection is marked sent');
      if (new Set(add).size !== add.length || new Set(remove.map(item => item.playerId)).size !== remove.length || add.some(id => remove.some(item => item.playerId === id))) fail('Selection changes must be unique');
      if (add.some(id => (!retryKey && activity.teams.some(item => item.selectedPlayers.includes(id))) || !activity.invitations.some(item => item.playerId === id && item.response === 'accepted'))) fail('Added players need accepted invitations and cannot already be selected');
      if (!retryKey && remove.some(item => !team!.selectedPlayers.includes(item.playerId))) fail('Removed player is not selected');
      if (!retryKey && team!.selectedPlayers.length + add.length - remove.length > (activity.maxPlayersPerTeam ?? Infinity)) fail('Team capacity exceeded');
      return { type: 'ChangeSelection', teamId: team!.id, add, remove };
    }
    case 'addInvitations': {
      if (!keys(body, ['players'], ['players']) || !Array.isArray(body.players)) fail('Invalid invitations');
      const players = body.players as Array<{ playerId: string; response: ActivityInvitation['response'] }>;
      if (!players.every(item => keys(item, ['playerId', 'response'], ['playerId', 'response']) && string(item.playerId) && ['open', 'accepted', 'declined'].includes(item.response))) fail('Invalid invitations');
      if (new Set(players.map(item => item.playerId)).size !== players.length || (!retryKey && players.some(item => activity.invitations.some(existing => existing.playerId === item.playerId)))) fail('Duplicate invitation');
      const memberIds = new Set(await dataStore.getGroupMemberIds(activity.squadId));
      if (players.some(item => !memberIds.has(item.playerId))) fail('Invited player is not a squad member');
      return { type: 'AddInvitations', invitations: players.map(item => ({
        id: idempotencyKey ? createHash('sha256').update(`${activity.id}:${idempotencyKey}:${item.playerId}`).digest('hex').slice(0, 32) : randomUUID(),
        playerId: item.playerId, response: item.response
      })) };
    }
    case 'removeInvitation':
      if (!retryKey && !activity.invitations.some(item => item.playerId === req.params.playerId)) fail('Invitation not found');
      return { type: 'RemoveInvitation', playerId: req.params.playerId };
    case 'attendance': {
      if (!keys(body, ['changes'], ['changes']) || !Array.isArray(body.changes)) fail('Invalid attendance changes');
      const timingError = attendanceTimingError(activity);
      if (timingError) fail(timingError);
      const changes = body.changes as Array<{ personId: string; status: ActivityAttendance['status'] | null; reason?: string }>;
      if (!changes.every(item => keys(item, ['personId', 'status', 'reason'], ['personId', 'status']) && string(item.personId) && (item.status === null || ['present', 'absent', 'excused'].includes(item.status)) && (item.reason === undefined || (item.status !== null && string(item.reason))))) fail('Invalid attendance change');
      if (new Set(changes.map(item => item.personId)).size !== changes.length) fail('Duplicate attendance person');
      const selected = new Set(activity.teams.flatMap(item => item.selectedPlayers));
      if (changes.some(item => !selected.has(item.personId))) fail('Attendance person must be selected');
      return { type: 'PatchAttendance', changes };
    }
  }
}

export const activityIntent = (intent: Intent) => async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await dataStore.getActivityById(req.params.groupId, req.params.id);
    if (!activity) { res.status(404).json({ error: 'Activity not found' }); return; }
    if (activity.status !== 'active') { res.status(400).json({ error: 'Cancelled activities are read-only' }); return; }
    const command = await buildCommand(intent, req, activity);
    let projected: Activity | null = activity;
    const retryKey = typeof req.header === 'function' ? req.header('Idempotency-Key') : undefined;
    const previous = retryKey && await activityEventStore.getByIdempotencyKey(activity.squadId, retryKey);
    if (!previous) {
      for (const event of decideActivityCommand(activity, command)) projected = applyActivityEvent(projected, false, event as import('../types/activityEvents').ActivityDomainEvent).activity;
    }
    if (!projected) throw new ActivityCommandError('Command removed Activity');
    if (!previous) {
      const selectionError = selectionTimingError(activity, projected);
      if (selectionError) fail(selectionError);
    }
    const teams = validateTeams(projected.kind, projected.teams, projected.invitations, projected.selectionSentAt !== undefined);
    if (teams.error) fail(teams.error);
    const updated = await dataStore.executeActivityIntent(activity, command, writeContextFromRequest(req));
    if (!updated) { res.status(404).json({ error: 'Activity not found' }); return; }
    setActivityEtag(res, await dataStore.getActivityRevision(updated.squadId, updated.id));
    res.json(updated);
  } catch (error) {
    if (handleActivityWriteError(error, res)) return;
    if (error instanceof ActivityCommandError) { res.status(error.message.includes('not found') ? 404 : 400).json({ error: error.message }); return; }
    console.error('Activity intent failed:', error);
    res.status(500).json({ error: 'Failed to update Activity' });
  }
};
