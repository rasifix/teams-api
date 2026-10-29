import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { Activity, ActivityKind, ActivityInvitation, GroupRole, Player, PlayerStatus, Team, Trainer } from '../types';
import { getNextSequence } from '../utils/sequence';
import { GroupAuthRequest } from '../middleware/groupAuth';
import type { ActivityWriteContext } from '../domain/activityCommandService';

type RecordValue = Record<string, unknown>;
type MemberDecision =
  | { action: 'link'; spondMemberId: string; memberId: string }
  | { action: 'create-player'; spondMemberId: string; birthDate: string; level: number; status: PlayerStatus; guardianIds: string[] }
  | { action: 'skip'; spondMemberId: string };
type TrainerDecision =
  | { action: 'link'; spondMemberId: string; memberId: string }
  | { action: 'create-trainer'; spondMemberId: string }
  | { action: 'skip'; spondMemberId: string };
type ActivityDecision =
  | { action: 'link'; spondEventId: string; activityId: string }
  | { action: 'create'; spondEventId: string; kind: ActivityKind; teams?: Array<{ name: string; strength: number; selectedPlayers: string[] }> }
  | { action: 'skip'; spondEventId: string }
  | { action: 'delete'; spondEventId: string };

const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validDate = (value: unknown): value is string => nonEmpty(value) && !Number.isNaN(Date.parse(value));
const activityKinds: ActivityKind[] = ['match', 'tournament'];
const normalized = (value: string): string => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const validateMemberDecision = (value: unknown): value is MemberDecision => {
  if (!isRecord(value) || !nonEmpty(value.action) || !nonEmpty(value.spondMemberId)) return false;
  if (value.action === 'skip') return true;
  if (value.action === 'link') return nonEmpty(value.memberId);
  return value.action === 'create-player'
    && nonEmpty(value.birthDate) && /^\d{4}-\d{2}-\d{2}$/.test(value.birthDate)
    && Number.isInteger(value.level) && Number(value.level) >= 1 && Number(value.level) <= 5
    && ['active', 'trial', 'inactive'].includes(String(value.status))
    && Array.isArray(value.guardianIds) && value.guardianIds.every(nonEmpty);
};

const validateActivityDecision = (value: unknown): value is ActivityDecision => {
  if (!isRecord(value) || !nonEmpty(value.action) || !nonEmpty(value.spondEventId)) return false;
  if (value.action === 'skip') return true;
  if (value.action === 'delete') return true;
  if (value.action === 'link') return nonEmpty(value.activityId);
  return value.action === 'create' && activityKinds.includes(value.kind as ActivityKind)
    && (value.teams === undefined || Array.isArray(value.teams));
};

const validateTrainerDecision = (value: unknown): value is TrainerDecision => {
  if (!isRecord(value) || !nonEmpty(value.action) || !nonEmpty(value.spondMemberId)) return false;
  if (value.action === 'skip' || value.action === 'create-trainer') return true;
  return value.action === 'link' && nonEmpty(value.memberId);
};

const validatePayload = (value: unknown): { body?: RecordValue; error?: string } => {
  if (!isRecord(value) || !nonEmpty(value.importId) || !nonEmpty(value.spondGroupId) || !validDate(value.from) || !validDate(value.to)) {
    return { error: 'Invalid import metadata' };
  }
  if (!isRecord(value.snapshot) || !isRecord(value.snapshot.group) || value.snapshot.group.id !== value.spondGroupId
    || !Array.isArray(value.snapshot.group.members) || !Array.isArray(value.snapshot.activities)) {
    return { error: 'Invalid or mismatched snapshot' };
  }
  if (!Array.isArray(value.members) || !value.members.every(validateMemberDecision)
    || !Array.isArray(value.trainers) || !value.trainers.every(validateTrainerDecision)
    || !Array.isArray(value.activities) || !value.activities.every(validateActivityDecision)) {
    return { error: 'Invalid import decisions' };
  }
  return { body: value };
};

const sourceMember = (members: unknown[], id: string): RecordValue | undefined =>
  members.find(value => isRecord(value) && value.id === id) as RecordValue | undefined;
const sourceEvent = (events: unknown[], id: string): RecordValue | undefined =>
  events.find(value => isRecord(value) && value.id === id) as RecordValue | undefined;

const activityWriteContextFromRequest = (req: GroupAuthRequest): ActivityWriteContext => ({
  actor: {
    type: 'user',
    userId: req.user?.id,
    memberId: req.groupAccess?.memberId,
    roles: req.groupAccess?.roles
  }
});

const sameInvitations = (left: ActivityInvitation[], right: ActivityInvitation[]): boolean => {
  if (left.length !== right.length) return false;
  const signature = (invitation: ActivityInvitation): string => JSON.stringify({
    id: invitation.id,
    playerId: invitation.playerId,
    response: invitation.response,
    declineReason: invitation.declineReason,
    respondedBy: invitation.respondedBy
  });
  const sortInvitations = (invitations: ActivityInvitation[]): string[] =>
    invitations.map(signature).sort();
  const rightSignatures = sortInvitations(right);
  return sortInvitations(left).every((value, index) => value === rightSignatures[index]);
};

const buildTeams = async (decision: Extract<ActivityDecision, { action: 'create' }>, startsAt: string): Promise<Team[]> => {
  if (decision.kind !== 'match' && decision.kind !== 'tournament') return [];
  const values = decision.teams ?? [];
  const teams: Team[] = [];
  for (const value of values) {
    teams.push({
      id: await getNextSequence('teams'),
      name: value.name,
      strength: value.strength,
      startTime: startsAt.slice(11, 16),
      selectedPlayers: value.selectedPlayers,
      status: 'new'
    });
  }
  return teams;
};

export const importSpondSnapshot = async (req: Request, res: Response): Promise<void> => {
  const validation = validatePayload(req.body);
  if (!validation.body) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const body = validation.body;
  const groupId = req.params.groupId;
  const snapshot = body.snapshot as RecordValue;
  const snapshotGroup = snapshot.group as RecordValue;
  const sourceMembers = snapshotGroup.members as unknown[];
  const sourceEvents = snapshot.activities as unknown[];
  const memberDecisions = body.members as MemberDecision[];
  const trainerDecisions = body.trainers as TrainerDecision[];
  const activityDecisions = body.activities as ActivityDecision[];
  const activityWriteContext = activityWriteContextFromRequest(req as GroupAuthRequest);
  const result = { importId: body.importId as string, created: 0, linked: 0, updated: 0, unchanged: 0, skipped: 0, warnings: [] as string[] };

  try {
    const group = await dataStore.getGroupById(groupId);
    if (!group) {
      res.status(404).json({ error: 'Squad not found' });
      return;
    }
    if (group.spondId && group.spondId !== body.spondGroupId) {
      res.status(409).json({ error: 'SPOND_GROUP_ALREADY_LINKED' });
      return;
    }
    if (group.spondId !== body.spondGroupId) await dataStore.updateGroup(groupId, { spondId: body.spondGroupId as string });

    const playerBySpondId = new Map<string, Player>();
    for (const decision of memberDecisions) {
      if (decision.action === 'skip') {
        result.skipped += 1;
        continue;
      }
      const source = sourceMember(sourceMembers, decision.spondMemberId);
      if (!source || !nonEmpty(source.firstName) || !nonEmpty(source.lastName)) {
        res.status(400).json({ error: 'SPOND_MEMBER_NOT_IN_SNAPSHOT' });
        return;
      }
      const existingExternal = await dataStore.getPlayerBySpondId(groupId, decision.spondMemberId);
      const existingTrainer = !existingExternal
        ? await dataStore.getTrainerBySpondId(groupId, decision.spondMemberId)
        : undefined;
      if (existingTrainer) {
        if (decision.action === 'link' && existingTrainer.id !== decision.memberId) {
          res.status(409).json({ error: 'SPOND_MEMBER_ALREADY_LINKED' });
          return;
        }
        if (!(await dataStore.addMemberRole(existingTrainer.id, 'player'))) throw new Error('Failed to add player role');
      }
      const resolvedExternal = existingExternal ?? (existingTrainer
        ? await dataStore.getPlayerBySpondId(groupId, decision.spondMemberId)
        : undefined);
      if (decision.action === 'link') {
        const local = await dataStore.getPlayerById(decision.memberId);
        if (!local || local.groupId !== groupId) {
          res.status(400).json({ error: 'SPOND_LINK_TARGET_INVALID' });
          return;
        }
        if (resolvedExternal && resolvedExternal.id !== local.id) {
          res.status(409).json({ error: 'SPOND_MEMBER_ALREADY_LINKED' });
          return;
        }
        const alreadyLinked = local.spondId === decision.spondMemberId;
        const nameChanged = normalized(local.firstName) !== normalized(source.firstName)
          || normalized(local.lastName) !== normalized(source.lastName);
        const sourceBirthDate = nonEmpty(source.birthDate) ? source.birthDate : undefined;
        const birthDateChanged = Boolean(sourceBirthDate && local.birthDate !== sourceBirthDate);
        const linked = !alreadyLinked || nameChanged || birthDateChanged
          ? await dataStore.updatePlayer(local.id, {
            spondId: decision.spondMemberId,
            firstName: source.firstName,
            lastName: source.lastName,
            ...(sourceBirthDate ? { birthDate: sourceBirthDate } : {})
          })
          : local;
        if (!linked) throw new Error('Failed to link player');
        playerBySpondId.set(decision.spondMemberId, linked);
        result[alreadyLinked ? (nameChanged || birthDateChanged ? 'updated' : 'unchanged') : 'linked'] += 1;
        continue;
      }

      if (resolvedExternal) {
        const updated = await dataStore.updatePlayer(resolvedExternal.id, {
          firstName: source.firstName,
          lastName: source.lastName,
          birthDate: decision.birthDate,
          level: decision.level,
          status: decision.status,
          spondId: decision.spondMemberId
        });
        if (!updated) throw new Error('Failed to update player');
        playerBySpondId.set(decision.spondMemberId, updated);
        result.updated += 1;
      } else {
        const created = await dataStore.createPlayer({
          id: await getNextSequence('members'), groupId, roles: ['player'], spondId: decision.spondMemberId,
          firstName: source.firstName, lastName: source.lastName, birthDate: decision.birthDate,
          level: decision.level, status: decision.status
        });
        playerBySpondId.set(decision.spondMemberId, created);
        result.created += 1;
      }

      const player = playerBySpondId.get(decision.spondMemberId)!;
      const guardians = Array.isArray(source.guardians) ? source.guardians : [];
      for (const guardianId of decision.guardianIds) {
        const guardianSource = guardians.find(value => isRecord(value) && value.id === guardianId) as RecordValue | undefined;
        if (!guardianSource || !nonEmpty(guardianSource.firstName) || !nonEmpty(guardianSource.lastName)) {
          res.status(400).json({ error: 'SPOND_GUARDIAN_NOT_IN_SNAPSHOT' });
          return;
        }
        let guardian = await dataStore.getTrainerBySpondId(groupId, guardianId);
        if (!guardian) {
          guardian = await dataStore.createTrainer({
            id: await getNextSequence('members'), groupId, roles: ['guardian'], spondId: guardianId,
            firstName: guardianSource.firstName, lastName: guardianSource.lastName,
            email: nonEmpty(guardianSource.email) ? guardianSource.email.toLowerCase() : undefined
          });
          result.created += 1;
        }
        await dataStore.addGuardianLink(groupId, guardian.id, player.id);
      }
    }

    for (const decision of trainerDecisions) {
      if (decision.action === 'skip') {
        result.skipped += 1;
        continue;
      }
      const source = sourceMember(sourceMembers, decision.spondMemberId);
      if (!source || !nonEmpty(source.firstName) || !nonEmpty(source.lastName)) {
        res.status(400).json({ error: 'SPOND_MEMBER_NOT_IN_SNAPSHOT' });
        return;
      }
      const roles = Array.isArray(source.roles) ? source.roles.filter((role): role is string => typeof role === 'string') : [];
      if (roles.some(role => /^(admin|administrator)$/i.test(role))
        || !roles.some(role => /(^|\s)(coach|trainer)(\s|$)/i.test(role))) {
        res.status(400).json({ error: 'SPOND_MEMBER_NOT_TRAINER' });
        return;
      }

      const existingBySpondId = await dataStore.getTrainerBySpondId(groupId, decision.spondMemberId);
      const existingPlayer = await dataStore.getPlayerBySpondId(groupId, decision.spondMemberId);
      let target: Trainer | undefined;
      if (decision.action === 'link') {
        target = await dataStore.getTrainerById(decision.memberId);
        if (!target || target.groupId !== groupId || !target.roles?.some(role => role === 'trainer' || role === 'admin')) {
          res.status(400).json({ error: 'SPOND_LINK_TARGET_INVALID' });
          return;
        }
        if ((existingBySpondId && existingBySpondId.id !== target.id)
          || (existingPlayer && existingPlayer.id !== target.id)
          || (target.spondId && target.spondId !== decision.spondMemberId)) {
          res.status(409).json({ error: 'SPOND_MEMBER_ALREADY_LINKED' });
          return;
        }
      } else {
        target = existingBySpondId;
        if (!target && existingPlayer) {
          if (!(await dataStore.addMemberRole(existingPlayer.id, 'trainer'))) throw new Error('Failed to add trainer role');
          target = await dataStore.getTrainerBySpondId(groupId, decision.spondMemberId);
        }
      }

      if (target) {
        const wasLinked = target.spondId === decision.spondMemberId;
        const nameChanged = normalized(target.firstName ?? '') !== normalized(source.firstName)
          || normalized(target.lastName ?? '') !== normalized(source.lastName);
        const updated = await dataStore.updateTrainer(target.id, {
          spondId: decision.spondMemberId,
          firstName: source.firstName,
          lastName: source.lastName,
          roles: Array.from(new Set<GroupRole>([...(target.roles ?? []), 'trainer']))
        });
        if (!updated) throw new Error('Failed to update trainer');
        result[wasLinked ? (nameChanged ? 'updated' : 'unchanged') : 'linked'] += 1;
      } else {
        await dataStore.createTrainer({
          id: await getNextSequence('members'), groupId, roles: ['trainer'], spondId: decision.spondMemberId,
          firstName: source.firstName, lastName: source.lastName,
          email: nonEmpty(source.email) ? source.email.toLowerCase() : undefined
        });
        result.created += 1;
      }
    }

    for (const decision of activityDecisions) {
      if (decision.action === 'skip') {
        result.skipped += 1;
        continue;
      }
      const source = sourceEvent(sourceEvents, decision.spondEventId);
      if (!source || source.groupId !== body.spondGroupId || !nonEmpty(source.name) || !validDate(source.startsAt)
        || !nonEmpty(source.type)
        || !['active', 'cancelled', 'deleted'].includes(String(source.status))) {
        res.status(400).json({ error: 'SPOND_EVENT_NOT_IN_SNAPSHOT' });
        return;
      }
      if (source.status === 'deleted' && decision.action !== 'delete') {
        res.status(400).json({ error: 'SPOND_DELETED_ACTIVITY_REQUIRES_DELETE' });
        return;
      }
      const existingExternal = await dataStore.getActivityBySpondId(groupId, decision.spondEventId);

      if (decision.action === 'delete') {
        if (existingExternal && !(await dataStore.deleteActivity(groupId, existingExternal.id, activityWriteContext))) {
          throw new Error('Failed to delete imported activity');
        }
        continue;
      }

      let target = existingExternal;
      if (decision.action === 'link') {
        const local = await dataStore.getActivityById(groupId, decision.activityId);
        if (!local) {
          res.status(400).json({ error: 'SPOND_LINK_TARGET_INVALID' });
          return;
        }
        if (existingExternal && existingExternal.id !== local.id) {
          res.status(409).json({ error: 'SPOND_EVENT_ALREADY_LINKED' });
          return;
        }
        target = local;
      }

      const responses = Array.isArray(source.responses) ? source.responses : [];
      const existingInvitationIds = new Map((target?.invitations ?? []).map(invitation => [invitation.playerId, invitation.id]));
      const invitations: ActivityInvitation[] = [];
      for (const response of responses) {
        if (!isRecord(response) || !nonEmpty(response.spondMemberId)
          || !['open', 'accepted', 'declined'].includes(String(response.response))) continue;
        const player = playerBySpondId.get(response.spondMemberId)
          ?? await dataStore.getPlayerBySpondId(groupId, response.spondMemberId);
        if (!player) continue;
        const existingInvitation = target?.invitations.find(invitation => invitation.playerId === player.id);
        const nextResponse = response.response as ActivityInvitation['response'];
        invitations.push({
          id: existingInvitationIds.get(player.id) ?? await getNextSequence('invitations'),
          playerId: player.id,
          response: nextResponse,
          ...(existingInvitation?.response === nextResponse ? {
            declineReason: existingInvitation.declineReason,
            respondedBy: existingInvitation.respondedBy
          } : {})
        });
      }

      const teams = decision.action === 'create'
        ? await buildTeams(decision, source.startsAt)
        : target?.teams ?? [];
      const kind = decision.action === 'create' ? decision.kind : target!.kind;
      const activity: Activity = {
        ...(target ?? { id: await getNextSequence('events') }),
        spondId: decision.spondEventId,
        squadId: groupId,
        kind,
        status: source.status === 'cancelled' ? 'cancelled' : 'active',
        name: source.name,
        startsAt: source.startsAt,
        endsAt: validDate(source.endsAt) ? source.endsAt : undefined,
        location: nonEmpty(source.location) ? source.location : undefined,
        minPlayersPerTeam: kind === 'match' || kind === 'tournament' ? target?.minPlayersPerTeam ?? 1 : undefined,
        maxPlayersPerTeam: kind === 'match' || kind === 'tournament' ? target?.maxPlayersPerTeam ?? 99 : undefined,
        teams,
        invitations,
      };
      if (target) {
        const changed = target.spondId !== activity.spondId || target.name !== activity.name
          || target.status !== activity.status
          || target.startsAt !== activity.startsAt || target.endsAt !== activity.endsAt
          || target.location !== activity.location || !sameInvitations(target.invitations, activity.invitations);
        if (changed) {
          if (!(await dataStore.updateActivity(activity, activityWriteContext))) throw new Error('Failed to update activity');
          result[decision.action === 'link' && !target.spondId ? 'linked' : 'updated'] += 1;
        } else result.unchanged += 1;
      } else {
        await dataStore.createActivity(activity, activityWriteContext);
        result.created += 1;
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Error importing Spond snapshot:', error);
    res.status(500).json({ error: 'SPOND_IMPORT_FAILED' });
  }
};
