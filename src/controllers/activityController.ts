import { Request, Response } from 'express';
import {
  Activity,
  ActivityAttendance,
  ActivityInvitation,
  ActivityKind,
  ActivityTask,
  InvitationDeclineReason,
  Team,
  TrainingGroup
} from '../types';
import { GroupAuthRequest } from '../middleware/groupAuth';
import { dataStore } from '../data/store';
import { getNextSequence } from '../utils/sequence';

const isActivityKind = (value: unknown): value is ActivityKind =>
  value === 'match' || value === 'tournament' || value === 'training' || value === 'social';

const isDeclineReason = (value: unknown): value is InvitationDeclineReason =>
  value === 'injured' || value === 'sick' || value === 'unavailable';

const validDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
  !Number.isNaN(Date.parse(value));

const isGuardianOnly = (req: Request): boolean => {
  const roles = (req as GroupAuthRequest).groupAccess?.roles ?? [];
  return roles.includes('guardian') && !roles.includes('admin') && !roles.includes('trainer');
};

const validateTeams = (
  kind: ActivityKind,
  teamsValue: unknown,
  invitations: ActivityInvitation[],
  selectionSent: boolean
): { teams?: Team[]; error?: string } => {
  if (!Array.isArray(teamsValue)) {
    return { error: 'teams must be an array' };
  }
  if (kind === 'match' && teamsValue.length !== 1) {
    return { error: 'match activities must have exactly one team' };
  }
  if (kind === 'tournament' && teamsValue.length < 1) {
    return { error: 'tournament activities must have at least one team' };
  }
  if (kind === 'training' || kind === 'social') {
    return { error: `${kind} activities are not supported yet` };
  }

  const acceptedPlayerIds = new Set(
    invitations.filter(invitation => invitation.response === 'accepted').map(invitation => invitation.playerId)
  );
  const selectedPlayerIds = new Set<string>();
  const teams: Team[] = [];

  for (let index = 0; index < teamsValue.length; index += 1) {
    const team = teamsValue[index] as Partial<Team>;
    if (!team || typeof team !== 'object' || typeof team.id !== 'string' || typeof team.name !== 'string') {
      return { error: `teams[${index}] must include string id and name` };
    }
    if (!Array.isArray(team.selectedPlayers) || !team.selectedPlayers.every(playerId => typeof playerId === 'string')) {
      return { error: `teams[${index}].selectedPlayers must be an array of player IDs` };
    }
    if (team.lineup !== undefined && kind === 'tournament') {
      return { error: 'tournament teams must not have a lineup' };
    }
    if (team.startTime !== undefined && (typeof team.startTime !== 'string' || !/^\d{2}:\d{2}$/.test(team.startTime))) {
      return { error: `teams[${index}].startTime must use HH:MM format` };
    }
    if (selectionSent && (!Array.isArray(team.responsiblePersonIds) || team.responsiblePersonIds.length < 1)) {
      return { error: `teams[${index}].responsiblePersonIds must contain at least one person when selection is sent` };
    }
    for (const playerId of team.selectedPlayers) {
      if (selectedPlayerIds.has(playerId)) {
        return { error: `player ${playerId} cannot be selected for more than one team` };
      }
      if (!acceptedPlayerIds.has(playerId)) {
        return { error: `selected player ${playerId} must have an accepted invitation` };
      }
      selectedPlayerIds.add(playerId);
    }
    teams.push({
      ...team,
      strength: typeof team.strength === 'number' ? team.strength : 2,
      startTime: team.startTime ?? '00:00',
      selectedPlayers: team.selectedPlayers,
      trainerId: team.responsiblePersonIds?.[0] ?? team.trainerId
    } as Team);
  }

  return { teams };
};

const validateActivity = (value: Record<string, unknown>, existing?: Activity): { activity?: Activity; error?: string } => {
  const kind = value.kind ?? existing?.kind;
  if (!isActivityKind(kind)) {
    return { error: 'kind must be match, tournament, training, or social' };
  }

  const name = value.name ?? existing?.name;
  if (typeof name !== 'string' || !name.trim()) {
    return { error: 'name is required' };
  }
  const startsAt = value.startsAt ?? existing?.startsAt;
  if (!validDate(startsAt)) {
    return { error: 'startsAt must be a valid date-time' };
  }
  const endsAt = value.endsAt !== undefined ? value.endsAt : existing?.endsAt;
  if (endsAt !== undefined && endsAt !== null && !validDate(endsAt)) {
    return { error: 'endsAt must be a valid date-time when provided' };
  }
  const matchFormatId = value.matchFormatId !== undefined ? value.matchFormatId : existing?.matchFormatId;
  if (matchFormatId !== undefined && matchFormatId !== null &&
    (typeof matchFormatId !== 'string' || matchFormatId.trim() === '')) {
    return { error: 'matchFormatId must be a non-empty string or null' };
  }
  const minPlayersPerTeam = value.minPlayersPerTeam ?? existing?.minPlayersPerTeam;
  const maxPlayersPerTeam = value.maxPlayersPerTeam ?? existing?.maxPlayersPerTeam;
  if (kind === 'match' || kind === 'tournament') {
    if (!Number.isInteger(minPlayersPerTeam) || Number(minPlayersPerTeam) < 1) {
      return { error: 'minPlayersPerTeam must be an integer greater than or equal to 1' };
    }
    if (!Number.isInteger(maxPlayersPerTeam) || Number(maxPlayersPerTeam) < 1) {
      return { error: 'maxPlayersPerTeam must be an integer greater than or equal to 1' };
    }
    if (Number(minPlayersPerTeam) > Number(maxPlayersPerTeam)) {
      return { error: 'minPlayersPerTeam must not exceed maxPlayersPerTeam' };
    }
  } else if (minPlayersPerTeam !== undefined || maxPlayersPerTeam !== undefined) {
    return { error: `${kind} activities do not have player limits` };
  }

  const incomingInvitations = value.invitations ?? existing?.invitations ?? [];
  if (!Array.isArray(incomingInvitations)) {
    return { error: 'invitations must be an array' };
  }
  const invitations = incomingInvitations as ActivityInvitation[];
  if (!invitations.every(invitation =>
    invitation && typeof invitation.id === 'string' && typeof invitation.playerId === 'string' &&
    (invitation.response === 'open' || invitation.response === 'accepted' || invitation.response === 'declined') &&
    (invitation.declineReason === undefined || isDeclineReason(invitation.declineReason))
  )) {
    return { error: 'each invitation must include id, playerId, and a valid response' };
  }

  const teamsValue = value.teams ?? existing?.teams;
  const selectionSentAt = value.selectionSentAt ?? existing?.selectionSentAt;
  let teams: Team[] = [];
  let trainerIds: string[] | undefined;
  let groups: TrainingGroup[] | undefined;
  if (kind === 'match' || kind === 'tournament') {
    const teamsResult = validateTeams(kind, teamsValue, invitations, selectionSentAt !== undefined);
    if (teamsResult.error || !teamsResult.teams) {
      return { error: teamsResult.error };
    }
    teams = teamsResult.teams;
  } else {
    if (Array.isArray(teamsValue) && teamsValue.length > 0) {
      return { error: `${kind} activities must not have teams` };
    }
    if (selectionSentAt !== undefined) {
      return { error: `${kind} activities do not support team selection` };
    }
    if (kind === 'training') {
      const trainerIdsValue = value.trainerIds ?? existing?.trainerIds;
      if (!Array.isArray(trainerIdsValue) || trainerIdsValue.length === 0 ||
        !trainerIdsValue.every(id => typeof id === 'string' && id.trim() !== '')) {
        return { error: 'training activities require at least one trainerId' };
      }
      trainerIds = [...new Set(trainerIdsValue as string[])];
      const groupsValue = value.groups ?? existing?.groups ?? [];
      if (!Array.isArray(groupsValue)) {
        return { error: 'training groups must be an array' };
      }
      const acceptedPlayerIds = new Set(
        invitations.filter(invitation => invitation.response === 'accepted').map(invitation => invitation.playerId)
      );
      groups = [];
      for (let groupIndex = 0; groupIndex < groupsValue.length; groupIndex += 1) {
        const group = groupsValue[groupIndex] as Partial<TrainingGroup>;
        if (!group || typeof group.id !== 'string' || !Array.isArray(group.units)) {
          return { error: `groups[${groupIndex}] must include an id and units array` };
        }
        const units = [];
        for (let unitIndex = 0; unitIndex < group.units.length; unitIndex += 1) {
          const unit = group.units[unitIndex];
          if (!unit || typeof unit.id !== 'string' || !Array.isArray(unit.plannedPlayerIds) ||
            !unit.plannedPlayerIds.every(id => typeof id === 'string')) {
            return { error: `groups[${groupIndex}].units[${unitIndex}] must include id and plannedPlayerIds` };
          }
          const unaccepted = unit.plannedPlayerIds.find(id => !acceptedPlayerIds.has(id));
          if (unaccepted) {
            return { error: `planned player ${unaccepted} must have an accepted invitation` };
          }
          units.push(unit);
        }
        groups.push({ id: group.id, name: group.name, units });
      }
    }
  }

  const squadId = value.squadId ?? existing?.squadId;
  const id = value.id ?? existing?.id;
  if (typeof squadId !== 'string' || typeof id !== 'string') {
    return { error: 'activity id and squadId are required' };
  }

  return {
    activity: {
      id,
      squadId,
      kind,
      name: name.trim(),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: endsAt === undefined || endsAt === null ? undefined : new Date(endsAt as string).toISOString(),
      location: typeof value.location === 'string' ? value.location : existing?.location,
      matchFormatId: matchFormatId as string | null | undefined,
      opponentName: typeof value.opponentName === 'string' ? value.opponentName : existing?.opponentName,
      minPlayersPerTeam: kind === 'match' || kind === 'tournament' ? Number(minPlayersPerTeam) : undefined,
      maxPlayersPerTeam: kind === 'match' || kind === 'tournament' ? Number(maxPlayersPerTeam) : undefined,
      teams,
      invitations,
      selectionSentAt: typeof selectionSentAt === 'string' ? selectionSentAt : undefined,
      attendance: existing?.attendance,
      tasks: existing?.tasks,
      trainerIds,
      groups
    }
  };
};

const getActivityOr404 = async (req: Request, res: Response): Promise<Activity | undefined> => {
  const { groupId, id } = req.params;
  const activity = await dataStore.getActivityById(groupId, id);
  if (!activity) {
    res.status(404).json({ error: 'Activity not found' });
    return undefined;
  }
  return activity;
};

const filterActivityForGuardian = async (req: Request, activity: Activity): Promise<Activity | null> => {
  const access = (req as GroupAuthRequest).groupAccess;
  if (!access || !isGuardianOnly(req)) {
    return activity;
  }
  const childIds = new Set(await dataStore.getGuardianChildPlayerIds(activity.squadId, access.memberId));
  const invitations = activity.invitations.filter(invitation => childIds.has(invitation.playerId));
  const teams = activity.teams
    .filter(team => team.selectedPlayers.some(playerId => childIds.has(playerId)))
    .map(team => ({
      ...team,
      selectedPlayers: team.selectedPlayers.filter(playerId => childIds.has(playerId)),
      shirtSetId: undefined,
      shirtAssignments: undefined
    }));
  const tasks = activity.tasks?.map(task => ({
    ...task,
    signups: task.signups.filter(signup => signup.personId === access.memberId)
  }));
  const attendance = activity.attendance?.filter(record => childIds.has(record.personId));
  const groups = activity.groups?.map(group => ({
    ...group,
    units: group.units.map(unit => ({
      ...unit,
      plannedPlayerIds: unit.plannedPlayerIds.filter(playerId => childIds.has(playerId))
    }))
  }));
  return activity.kind === 'social' || invitations.length || teams.length || attendance?.length || groups?.length
    ? { ...activity, invitations, teams, tasks, attendance, groups }
    : null;
};

export const getActivities = async (req: Request, res: Response): Promise<void> => {
  try {
    const kind = req.query.kind;
    if (kind !== undefined && !isActivityKind(kind)) {
      res.status(400).json({ error: 'kind must be match, tournament, training, or social' });
      return;
    }
    const startsAfter = req.query.startsAfter;
    const startsBefore = req.query.startsBefore;
    if (startsAfter !== undefined && !validDate(startsAfter)) {
      res.status(400).json({ error: 'startsAfter must be a valid date-time' });
      return;
    }
    if (startsBefore !== undefined && !validDate(startsBefore)) {
      res.status(400).json({ error: 'startsBefore must be a valid date-time' });
      return;
    }
    const activities = await dataStore.getActivities(req.params.groupId, {
      kind: kind as ActivityKind | undefined,
      startsAfter: startsAfter ? new Date(startsAfter as string) : undefined,
      startsBefore: startsBefore ? new Date(startsBefore as string) : undefined
    });
    if (!isGuardianOnly(req)) {
      res.json(activities);
      return;
    }
    const visible = (await Promise.all(activities.map(activity => filterActivityForGuardian(req, activity))))
      .filter((activity): activity is Activity => activity !== null);
    res.json(visible);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

export const getActivityById = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    const visible = await filterActivityForGuardian(req, activity);
    if (!visible) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.json(visible);
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
};

export const createActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = validateActivity({
      ...req.body,
      id: await getNextSequence('events'),
      squadId: req.params.groupId
    });
    if (!validation.activity) {
      res.status(400).json({ error: validation.error ?? 'Invalid activity' });
      return;
    }
    const created = await dataStore.createActivity(validation.activity);
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating activity:', error);
    res.status(500).json({ error: 'Failed to create activity' });
  }
};

export const updateActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await getActivityOr404(req, res);
    if (!existing) return;
    const validation = validateActivity({ ...existing, ...req.body, id: existing.id, squadId: existing.squadId }, existing);
    if (!validation.activity) {
      res.status(400).json({ error: validation.error ?? 'Invalid activity' });
      return;
    }
    const updated = await dataStore.updateActivity(validation.activity);
    if (!updated) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating activity:', error);
    res.status(500).json({ error: 'Failed to update activity' });
  }
};

export const deleteActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await dataStore.deleteActivity(req.params.groupId, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting activity:', error);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
};

const applyInvitationUpdate = (
  invitations: ActivityInvitation[],
  playerId: string,
  response: unknown,
  declineReason: unknown,
  respondedBy: string
): { invitations?: ActivityInvitation[]; error?: string } => {
  if (response !== 'open' && response !== 'accepted' && response !== 'declined') {
    return { error: 'response must be open, accepted, or declined' };
  }
  if (declineReason !== undefined && !isDeclineReason(declineReason)) {
    return { error: 'declineReason must be injured, sick, or unavailable' };
  }
  const index = invitations.findIndex(invitation => invitation.playerId === playerId);
  if (index < 0) return { error: 'Invitation not found' };
  const updated = [...invitations];
  updated[index] = {
    ...updated[index],
    response,
    declineReason: response === 'declined' ? declineReason as InvitationDeclineReason | undefined : undefined,
    respondedBy
  };
  return { invitations: updated };
};

const removeUnacceptedPlayersFromTeams = (
  teams: Team[],
  invitations: ActivityInvitation[]
): Team[] => {
  const acceptedPlayerIds = new Set(
    invitations.filter(invitation => invitation.response === 'accepted').map(invitation => invitation.playerId)
  );
  return teams.map(team => ({
    ...team,
    selectedPlayers: team.selectedPlayers.filter(playerId => acceptedPlayerIds.has(playerId)),
    lineup: team.lineup?.map(period => ({
      ...period,
      assignments: period.assignments.filter(assignment => acceptedPlayerIds.has(assignment.playerId))
    }))
  }));
};

const removeUnacceptedPlayersFromTrainingGroups = (
  groups: TrainingGroup[] | undefined,
  invitations: ActivityInvitation[]
): TrainingGroup[] | undefined => {
  if (!groups) return groups;
  const acceptedPlayerIds = new Set(
    invitations.filter(invitation => invitation.response === 'accepted').map(invitation => invitation.playerId)
  );
  return groups.map(group => ({
    ...group,
    units: group.units.map(unit => ({
      ...unit,
      plannedPlayerIds: unit.plannedPlayerIds.filter(playerId => acceptedPlayerIds.has(playerId))
    }))
  }));
};

const authorizeGuardianInvitation = async (
  req: Request,
  activity: Activity,
  playerId: string,
  response: unknown
): Promise<boolean> => {
  if (!isGuardianOnly(req)) return true;
  if (response !== 'accepted' && response !== 'declined') return false;
  const access = (req as GroupAuthRequest).groupAccess;
  if (!access) return false;
  const children = await dataStore.getGuardianChildPlayerIds(activity.squadId, access.memberId);
  return children.includes(playerId);
};

export const updateActivityInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    const playerId = req.params.playerId;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'invitation update must be an object' });
      return;
    }
    const { response, declineReason } = req.body;
    if (!(await authorizeGuardianInvitation(req, activity, playerId, response))) {
      res.status(403).json({ error: 'Guardians may only respond to their own child invitations with accepted or declined' });
      return;
    }
    const access = (req as GroupAuthRequest).groupAccess;
    const result = applyInvitationUpdate(activity.invitations, playerId, response, declineReason, access?.memberId ?? '');
    if (result.error || !result.invitations) {
      res.status(400).json({ error: result.error });
      return;
    }
    const reconciledTeams = removeUnacceptedPlayersFromTeams(activity.teams, result.invitations);
    const teams = activity.kind === 'match' || activity.kind === 'tournament'
      ? validateTeams(activity.kind, reconciledTeams, result.invitations, activity.selectionSentAt !== undefined)
      : { teams: activity.teams };
    if (teams.error) {
      res.status(400).json({ error: teams.error });
      return;
    }
    const updated = await dataStore.updateActivity({
      ...activity,
      invitations: result.invitations,
      teams: teams.teams!,
      groups: removeUnacceptedPlayersFromTrainingGroups(activity.groups, result.invitations)
    });
    if (!updated) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating activity invitation:', error);
    res.status(500).json({ error: 'Failed to update activity invitation' });
  }
};

export const updateActivityInvitations = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    if (!req.body || typeof req.body !== 'object' || !Array.isArray(req.body.invitations)) {
      res.status(400).json({ error: 'invitations must be an array' });
      return;
    }
    let invitations = activity.invitations;
    const access = (req as GroupAuthRequest).groupAccess;
    for (const item of req.body.invitations as Array<{ playerId?: unknown; response?: unknown; declineReason?: unknown }>) {
      if (!item || typeof item !== 'object' || typeof item.playerId !== 'string') {
        res.status(400).json({ error: 'each invitation update must include playerId' });
        return;
      }
      const result = applyInvitationUpdate(invitations, item.playerId, item.response, item.declineReason, access?.memberId ?? '');
      if (result.error || !result.invitations) {
        res.status(400).json({ error: result.error });
        return;
      }
      invitations = result.invitations;
    }
    const reconciledTeams = removeUnacceptedPlayersFromTeams(activity.teams, invitations);
    const teams = activity.kind === 'match' || activity.kind === 'tournament'
      ? validateTeams(activity.kind, reconciledTeams, invitations, activity.selectionSentAt !== undefined)
      : { teams: activity.teams };
    if (teams.error) {
      res.status(400).json({ error: teams.error });
      return;
    }
    const updated = await dataStore.updateActivity({
      ...activity,
      invitations,
      teams: teams.teams!,
      groups: removeUnacceptedPlayersFromTrainingGroups(activity.groups, invitations)
    });
    if (!updated) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating activity invitations:', error);
    res.status(500).json({ error: 'Failed to update activity invitations' });
  }
};

const isAttendanceStatus = (value: unknown): value is ActivityAttendance['status'] =>
  value === 'present' || value === 'absent' || value === 'excused';

const mergeAttendance = (
  current: ActivityAttendance[] = [],
  incoming: unknown
): { attendance?: ActivityAttendance[]; error?: string } => {
  if (!Array.isArray(incoming)) {
    return { error: 'attendance must be an array' };
  }
  const records = new Map(current.map(record => [record.personId, record.status]));
  for (const record of incoming as Array<{ personId?: unknown; status?: unknown }>) {
    if (!record || typeof record !== 'object' || typeof record.personId !== 'string' || !record.personId.trim()) {
      return { error: 'each attendance record must include a non-empty personId' };
    }
    if (!isAttendanceStatus(record.status)) {
      return { error: `attendance status for ${record.personId} must be present, absent, or excused` };
    }
    records.set(record.personId, record.status);
  }
  return { attendance: Array.from(records, ([personId, status]) => ({ personId, status })) };
};

const updateAttendance = async (
  req: Request,
  res: Response,
  incoming: unknown
): Promise<void> => {
  const activity = await getActivityOr404(req, res);
  if (!activity) return;
  if (Date.parse(activity.startsAt) >= Date.now()) {
    res.status(400).json({ error: 'Attendance can only be recorded after the activity starts' });
    return;
  }
  const result = mergeAttendance(activity.attendance, incoming);
  if (result.error || !result.attendance) {
    res.status(400).json({ error: result.error });
    return;
  }
  const memberIds = new Set(await dataStore.getGroupMemberIds(activity.squadId));
  const unknownPersonId = result.attendance.find(record => !memberIds.has(record.personId));
  if (unknownPersonId) {
    res.status(400).json({ error: `personId ${unknownPersonId.personId} is not a member of this squad` });
    return;
  }
  const updated = await dataStore.updateActivity({ ...activity, attendance: result.attendance });
  if (!updated) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }
  res.json(updated.attendance ?? []);
};

export const updateActivityAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'attendance update must be an object' });
      return;
    }
    await updateAttendance(req, res, req.body.attendance);
  } catch (error) {
    console.error('Error updating activity attendance:', error);
    res.status(500).json({ error: 'Failed to update activity attendance' });
  }
};

export const updateActivityAttendanceForPerson = async (req: Request, res: Response): Promise<void> => {
  try {
    const { personId } = req.params;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'attendance update must be an object' });
      return;
    }
    await updateAttendance(req, res, [{ personId, status: req.body.status }]);
  } catch (error) {
    console.error('Error updating activity attendance:', error);
    res.status(500).json({ error: 'Failed to update activity attendance' });
  }
};

const validateTaskDetails = (
  value: Record<string, unknown>,
  existing?: ActivityTask
): { task?: Omit<ActivityTask, 'id' | 'signups' | 'isFulfilled'>; error?: string } => {
  const name = value.name !== undefined ? value.name : existing?.name;
  if (typeof name !== 'string' || !name.trim()) {
    return { error: 'task name is required' };
  }
  const requiredPeople = value.requiredPeople !== undefined ? value.requiredPeople : existing?.requiredPeople;
  if (!Number.isInteger(requiredPeople) || Number(requiredPeople) < 1) {
    return { error: 'requiredPeople must be an integer greater than or equal to 1' };
  }
  const description = value.description !== undefined ? value.description : existing?.description;
  if (description !== undefined && typeof description !== 'string') {
    return { error: 'description must be a string when provided' };
  }
  return {
    task: {
      name: name.trim(),
      description: typeof description === 'string' ? description : undefined,
      requiredPeople: Number(requiredPeople)
    }
  };
};

const persistTasks = async (
  req: Request,
  res: Response,
  activity: Activity,
  taskValues: ActivityTask[]
): Promise<void> => {
  const updated = await dataStore.updateActivity({ ...activity, tasks: taskValues });
  if (!updated) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }
  const tasks = updated.tasks ?? [];
  const visibleTasks = isGuardianOnly(req)
    ? tasks.map(task => ({
      ...task,
      signups: task.signups.filter(signup => signup.personId === (req as GroupAuthRequest).groupAccess?.memberId)
    }))
    : tasks;
  res.json(visibleTasks);
};

export const createActivityTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'task must be an object' });
      return;
    }
    const details = validateTaskDetails(req.body);
    if (details.error || !details.task) {
      res.status(400).json({ error: details.error });
      return;
    }
    const task: ActivityTask = {
      id: await getNextSequence('activitytasks'),
      ...details.task,
      signups: [],
      isFulfilled: false
    };
    await persistTasks(req, res, activity, [...(activity.tasks ?? []), task]);
  } catch (error) {
    console.error('Error creating activity task:', error);
    res.status(500).json({ error: 'Failed to create activity task' });
  }
};

export const updateActivityTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    const tasks = activity.tasks ?? [];
    const index = tasks.findIndex(task => task.id === req.params.taskId);
    if (index < 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const details = validateTaskDetails(req.body ?? {}, tasks[index]);
    if (details.error || !details.task) {
      res.status(400).json({ error: details.error });
      return;
    }
    const updated = [...tasks];
    updated[index] = { ...tasks[index], ...details.task };
    await persistTasks(req, res, activity, updated);
  } catch (error) {
    console.error('Error updating activity task:', error);
    res.status(500).json({ error: 'Failed to update activity task' });
  }
};

export const deleteActivityTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    const tasks = activity.tasks ?? [];
    if (!tasks.some(task => task.id === req.params.taskId)) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    await persistTasks(req, res, activity, tasks.filter(task => task.id !== req.params.taskId));
  } catch (error) {
    console.error('Error deleting activity task:', error);
    res.status(500).json({ error: 'Failed to delete activity task' });
  }
};

const updateTaskSignup = async (req: Request, res: Response, signingUp: boolean): Promise<void> => {
  const access = (req as GroupAuthRequest).groupAccess;
  if (!access || !access.roles.some(role => role === 'admin' || role === 'trainer' || role === 'guardian')) {
    res.status(403).json({ error: 'Only adult squad members may sign up for tasks' });
    return;
  }
  const activity = await getActivityOr404(req, res);
  if (!activity) return;
  const tasks = activity.tasks ?? [];
  const index = tasks.findIndex(task => task.id === req.params.taskId);
  if (index < 0) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const updatedTasks = [...tasks];
  const task = { ...updatedTasks[index], signups: [...updatedTasks[index].signups] };
  const signupIndex = task.signups.findIndex(signup => signup.personId === access.memberId);
  if (signingUp && signupIndex < 0) {
    task.signups.push({ personId: access.memberId, signedUpAt: new Date().toISOString() });
  } else if (!signingUp && signupIndex >= 0) {
    task.signups.splice(signupIndex, 1);
  }
  task.isFulfilled = task.signups.length >= task.requiredPeople;
  updatedTasks[index] = task;
  await persistTasks(req, res, activity, updatedTasks);
};

export const signUpForActivityTask = async (req: Request, res: Response): Promise<void> => {
  try {
    await updateTaskSignup(req, res, true);
  } catch (error) {
    console.error('Error signing up for activity task:', error);
    res.status(500).json({ error: 'Failed to sign up for activity task' });
  }
};

export const withdrawFromActivityTask = async (req: Request, res: Response): Promise<void> => {
  try {
    await updateTaskSignup(req, res, false);
  } catch (error) {
    console.error('Error withdrawing from activity task:', error);
    res.status(500).json({ error: 'Failed to withdraw from activity task' });
  }
};

export const getActivityTeams = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    const visible = await filterActivityForGuardian(req, activity);
    if (!visible) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.json(visible.teams);
  } catch (error) {
    console.error('Error fetching activity teams:', error);
    res.status(500).json({ error: 'Failed to fetch activity teams' });
  }
};

export const updateActivityTeams = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    if (activity.kind !== 'match' && activity.kind !== 'tournament') {
      res.status(400).json({ error: `${activity.kind} activities do not support teams` });
      return;
    }
    const teams = validateTeams(activity.kind, req.body?.teams, activity.invitations, activity.selectionSentAt !== undefined);
    if (teams.error || !teams.teams) {
      res.status(400).json({ error: teams.error });
      return;
    }
    const updated = await dataStore.updateActivity({ ...activity, teams: teams.teams });
    if (!updated) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.json(updated.teams);
  } catch (error) {
    console.error('Error updating activity teams:', error);
    res.status(500).json({ error: 'Failed to update activity teams' });
  }
};

export const updateActivitySelection = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    if (activity.kind !== 'match' && activity.kind !== 'tournament') {
      res.status(400).json({ error: `${activity.kind} activities do not support team selection` });
      return;
    }
    const teams = validateTeams(activity.kind, req.body?.teams, activity.invitations, activity.selectionSentAt !== undefined);
    if (teams.error || !teams.teams) {
      res.status(400).json({ error: teams.error });
      return;
    }
    const updated = await dataStore.updateActivity({ ...activity, teams: teams.teams });
    if (!updated) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating activity selection:', error);
    res.status(500).json({ error: 'Failed to update activity selection' });
  }
};

export const markActivitySelectionSent = async (req: Request, res: Response): Promise<void> => {
  try {
    const activity = await getActivityOr404(req, res);
    if (!activity) return;
    if (activity.kind !== 'match' && activity.kind !== 'tournament') {
      res.status(400).json({ error: `${activity.kind} activities do not support team selection` });
      return;
    }
    const teams = validateTeams(activity.kind, activity.teams, activity.invitations, true);
    if (teams.error || !teams.teams) {
      res.status(400).json({ error: teams.error });
      return;
    }
    const updated = await dataStore.updateActivity({
      ...activity,
      teams: teams.teams,
      selectionSentAt: new Date().toISOString()
    });
    if (!updated) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    res.json(updated);
  } catch (error) {
    console.error('Error sending activity selection:', error);
    res.status(500).json({ error: 'Failed to send activity selection' });
  }
};
