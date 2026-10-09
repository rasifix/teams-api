import type { 
  GroupDocument,
  PeriodEmbedded,
  PlayingModeEmbedded,
  FormationEmbedded,
  PersonDocument, 
  EventDocument, 
  ShirtSetDocument,
  TeamEmbedded,
  InvitationEmbedded,
  EvaluationEmbedded
} from './mongodb';
import type { 
  Group,
  GroupRole,
  Activity,
  ActivityKind,
  ActivityInvitation,
  InvitationDeclineReason,
  Period,
  PlayingMode,
  Formation,
  FormationSlot,
  Player, 
  Trainer, 
  Event, 
  ShirtSet, 
  Team, 
  Invitation,
  PlayerEvaluation
} from './index';

export function embeddedPeriodToPeriod(embedded: PeriodEmbedded): Period {
  return {
    id: embedded.id,
    name: embedded.name,
    startDate: embedded.startDate,
    endDate: embedded.endDate
  };
}

export function periodToEmbedded(period: Period): PeriodEmbedded {
  return {
    id: period.id,
    name: period.name,
    startDate: period.startDate,
    endDate: period.endDate
  };
}

export function embeddedPlayingModeToPlayingMode(embedded: PlayingModeEmbedded): PlayingMode {
  return {
    id: embedded.id,
    name: embedded.name,
    numberOfPeriods: embedded.numberOfPeriods,
    periodLengthMinutes: embedded.periodLengthMinutes,
    minimumPeriodsPerPlayer: embedded.minimumPeriodsPerPlayer ?? 0,
    isDefault: embedded.isDefault ?? false,
    playersOnField: embedded.playersOnField,
    minPlayersPerTeam: embedded.minPlayersPerTeam,
    maxPlayersPerTeam: embedded.maxPlayersPerTeam,
    origin: embedded.origin
  };
}

export function playingModeToEmbedded(mode: PlayingMode): PlayingModeEmbedded {
  return {
    id: mode.id,
    name: mode.name,
    numberOfPeriods: mode.numberOfPeriods,
    periodLengthMinutes: mode.periodLengthMinutes,
    minimumPeriodsPerPlayer: mode.minimumPeriodsPerPlayer,
    isDefault: mode.isDefault ?? false,
    playersOnField: mode.playersOnField,
    minPlayersPerTeam: mode.minPlayersPerTeam,
    maxPlayersPerTeam: mode.maxPlayersPerTeam,
    origin: mode.origin
  };
}

export function embeddedFormationToFormation(embedded: FormationEmbedded): Formation {
  return {
    id: embedded.id,
    name: embedded.name,
    slots: embedded.slots.map(slot => ({
      id: slot.id,
      positionCode: slot.positionCode
    }))
  };
}

export function formationToEmbedded(formation: Formation): FormationEmbedded {
  return {
    id: formation.id,
    name: formation.name,
    slots: formation.slots.map((slot: FormationSlot) => ({
      id: slot.id,
      positionCode: slot.positionCode
    }))
  };
}

// Convert MongoDB GroupDocument to API Group
export function groupDocumentToGroup(doc: GroupDocument): Group {
  const playingModes = doc.playingModes?.map(embeddedPlayingModeToPlayingMode) ?? [];
  return {
    id: doc._id,
    name: doc.name,
    club: doc.club,
    category: doc.category,
    periods: doc.periods?.map(embeddedPeriodToPeriod) ?? [],
    matchPlanningEnabled: doc.matchPlanningEnabled ?? false,
    playingModes,
    formations: doc.formations?.map(embeddedFormationToFormation) ?? [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString()
  };
}

// Convert API Group to MongoDB GroupDocument (for create operations)
export function groupToGroupDocument(group: Group): Omit<GroupDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    name: group.name,
    club: group.club,
    category: group.category,
    periods: group.periods?.map(periodToEmbedded) ?? [],
    matchPlanningEnabled: group.matchPlanningEnabled ?? false,
    playingModes: (group.matchFormats ?? group.playingModes)?.map(playingModeToEmbedded) ?? [],
    formations: group.formations?.map(formationToEmbedded) ?? []
  };
}

// Convert embedded evaluation from MongoDB to API format
export function embeddedEvaluationToPlayerEvaluation(embedded: EvaluationEmbedded): PlayerEvaluation {
  return {
    id: embedded.id,
    playerId: embedded.playerId,
    evaluationDate: embedded.evaluationDate,
    userId: embedded.userId,
    score: embedded.score,
    comments: embedded.comments,
    createdAt: embedded.createdAt.toISOString()
  };
}

// Convert API evaluation to embedded format
export function playerEvaluationToEmbedded(evaluation: PlayerEvaluation): EvaluationEmbedded {
  return {
    id: evaluation.id,
    playerId: evaluation.playerId,
    evaluationDate: evaluation.evaluationDate,
    userId: evaluation.userId,
    score: evaluation.score,
    comments: evaluation.comments,
    createdAt: evaluation.createdAt ? new Date(evaluation.createdAt) : new Date()
  };
}

// Convert MongoDB PersonDocument to API Player
export function personDocumentToPlayer(doc: PersonDocument): Player | null {
  const normalizedRoles: GroupRole[] = doc.roles && doc.roles.length > 0
    ? doc.roles
    : (typeof doc.level === 'number' ? ['player'] : []);

  if (!normalizedRoles.includes('player') || !doc.level) {
    return null;
  }
  
  return {
    id: doc._id,
    groupId: doc.groupId,
    roles: normalizedRoles,
    firstName: doc.firstName!,
    lastName: doc.lastName!,
    birthDate: doc.birthDate,
    birthYear: birthYearFromBirthDate(doc.birthDate),
    level: doc.level,
    preferredShirtNumber: doc.preferredShirtNumber,
    status: doc.status ?? 'active',
    evaluations: doc.evaluations?.map(embeddedEvaluationToPlayerEvaluation)
  };
}

export function birthYearFromBirthDate(birthDate: string | undefined): number | undefined {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return undefined;
  }

  const parsed = new Date(`${birthDate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(birthDate)
    ? parsed.getUTCFullYear()
    : undefined;
}

// Convert MongoDB PersonDocument to API Trainer
export function personDocumentToTrainer(doc: PersonDocument): Trainer | null {
  const normalizedRoles: GroupRole[] = doc.roles && doc.roles.length > 0
    ? doc.roles
    : ['trainer'];

  if (!normalizedRoles.some(role => role === 'trainer' || role === 'admin' || role === 'guardian')) {
    return null;
  }
  
  const trainer: Trainer = {
    id: doc._id,
    groupId: doc.groupId,
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    roles: normalizedRoles
  };
  
  return trainer;
}

// Convert API Player to MongoDB PersonDocument (for create operations)
export function playerToPersonDocument(player: Player): Omit<PersonDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    firstName: player.firstName,
    lastName: player.lastName,
    roles: player.roles,
    groupId: player.groupId,
    birthDate: player.birthDate,
    level: player.level,
    preferredShirtNumber: player.preferredShirtNumber,
    status: player.status ?? 'active'
  };
}

// Convert API Trainer to MongoDB PersonDocument (for create operations)
export function trainerToPersonDocument(trainer: Trainer): Omit<PersonDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    firstName: trainer.firstName,
    lastName: trainer.lastName,
    roles: trainer.roles,
    groupId: trainer.groupId,
    email: trainer.email
  };
}

// Convert embedded invitation from MongoDB to API format
export function embeddedInvitationToInvitation(embedded: InvitationEmbedded): Invitation {
  return {
    id: embedded.id,
    playerId: embedded.playerId,
    status: embedded.status
  };
}

// Convert API invitation to embedded format
export function invitationToEmbedded(invitation: Invitation): InvitationEmbedded {
  const declineReason = DECLINE_REASONS.has(invitation.status as InvitationDeclineReason)
    ? invitation.status as InvitationDeclineReason
    : undefined;
  const response = declineReason ? 'declined' : invitation.status as ActivityInvitation['response'];
  return {
    id: invitation.id,
    playerId: invitation.playerId,
    status: invitation.status,
    response,
    declineReason,
    sentAt: new Date(),
    respondedAt: invitation.status !== 'open' ? new Date() : undefined
  };
}

const DECLINE_REASONS = new Set<InvitationDeclineReason>(['injured', 'sick', 'unavailable']);

export function embeddedInvitationToActivityInvitation(embedded: InvitationEmbedded): ActivityInvitation {
  const legacyDeclineReason = DECLINE_REASONS.has(embedded.status as InvitationDeclineReason)
    ? embedded.status as InvitationDeclineReason
    : undefined;
  const response = embedded.response ?? (legacyDeclineReason ? 'declined' : embedded.status as ActivityInvitation['response']);
  return {
    id: embedded.id,
    playerId: embedded.playerId,
    response,
    declineReason: embedded.declineReason ?? legacyDeclineReason,
    respondedBy: embedded.respondedBy
  };
}

export function activityInvitationToEmbedded(invitation: ActivityInvitation): InvitationEmbedded {
  const declineReason = invitation.response === 'declined' ? invitation.declineReason : undefined;
  const status = declineReason ?? invitation.response;
  return {
    id: invitation.id,
    playerId: invitation.playerId,
    response: invitation.response,
    declineReason,
    respondedBy: invitation.respondedBy,
    status,
    sentAt: new Date(),
    respondedAt: invitation.response === 'open' ? undefined : new Date()
  };
}

// Convert embedded team from MongoDB to API format
export function embeddedTeamToTeam(embedded: TeamEmbedded): Team {
  return {
    id: embedded.id,
    name: embedded.name,
    strength: embedded.strength,
    startTime: embedded.startTime,
    location: embedded.location,
    selectedPlayers: embedded.selectedPlayers,
    trainerId: embedded.trainerId ?? embedded.responsiblePersonIds?.[0],
    shirtSetId: embedded.shirtSetId,
    shirtAssignments: embedded.shirtAssignments?.map(assignment => ({
      playerId: assignment.playerId,
      shirtNumber: assignment.shirtNumber
    })),
    status: embedded.status ?? 'new', // Backward-compat: default to 'new' for old documents
    formationId: embedded.formationId,
    lineup: embedded.lineup?.map(period => ({
      periodNumber: period.periodNumber,
      assignments: period.assignments.map(assignment => ({
        slotId: assignment.slotId,
        playerId: assignment.playerId
      }))
    }))
  };
}

// Convert API team to embedded format
export function teamToEmbedded(team: Team): TeamEmbedded {
  return {
    id: team.id,
    name: team.name,
    strength: team.strength,
    startTime: team.startTime,
    location: team.location,
    selectedPlayers: team.selectedPlayers,
    trainerId: team.responsiblePersonIds?.[0] ?? team.trainerId,
    responsiblePersonIds: team.responsiblePersonIds ?? (team.trainerId ? [team.trainerId] : undefined),
    shirtSetId: team.shirtSetId,
    shirtAssignments: team.shirtAssignments?.map(assignment => ({
      playerId: assignment.playerId,
      shirtNumber: assignment.shirtNumber
    })),
    status: team.status ?? 'new',
    formationId: team.formationId,
    lineup: team.lineup?.map(period => ({
      periodNumber: period.periodNumber,
      assignments: period.assignments.map(assignment => ({
        slotId: assignment.slotId,
        playerId: assignment.playerId
      }))
    }))
  };
}

// Convert MongoDB EventDocument to API Event
export function eventDocumentToLegacyEvent(doc: EventDocument): Event {
  return {
    id: doc._id,
    groupId: doc.groupId,
    name: doc.name,
    date: doc.eventDate.toISOString().split('T')[0], // Convert Date to ISO string
    maxPlayersPerTeam: doc.maxPlayersPerTeam,
    minPlayersPerTeam: doc.minPlayersPerTeam,
    location: doc.location,
    playingModeId: doc.matchFormatId !== undefined ? doc.matchFormatId : doc.playingModeId,
    teams: doc.teams.map(embeddedTeamToTeam),
    invitations: doc.invitations.map(embeddedInvitationToInvitation)
  };
}

export const eventDocumentToEvent = eventDocumentToLegacyEvent;

const derivedActivityKind = (doc: EventDocument): ActivityKind => {
  if (doc.kind) {
    return doc.kind;
  }
  return doc.teams.length === 1 ? 'match' : 'tournament';
};

const deriveStartsAt = (doc: EventDocument): Date => {
  if (doc.startsAt) {
    return doc.startsAt;
  }

  const earliestStartTime = doc.teams
    .map(team => team.startTime)
    .filter(value => /^\d{2}:\d{2}$/.test(value))
    .sort()[0] ?? '00:00';
  const date = doc.eventDate.toISOString().slice(0, 10);
  return new Date(`${date}T${earliestStartTime}:00.000Z`);
};

export function eventDocumentToActivity(doc: EventDocument): Activity {
  const startsAt = deriveStartsAt(doc);
  const kind = derivedActivityKind(doc);
  return {
    id: doc._id,
    squadId: doc.groupId,
    kind,
    name: doc.name,
    startsAt: startsAt.toISOString(),
    endsAt: doc.endsAt?.toISOString(),
    location: doc.location,
    matchFormatId: doc.matchFormatId !== undefined ? doc.matchFormatId : doc.playingModeId,
    opponentName: doc.opponentName,
    maxPlayersPerTeam: kind === 'match' || kind === 'tournament' ? doc.maxPlayersPerTeam : undefined,
    minPlayersPerTeam: kind === 'match' || kind === 'tournament' ? doc.minPlayersPerTeam : undefined,
    teams: doc.teams.map(team => ({
      ...embeddedTeamToTeam(team),
      responsiblePersonIds: team.responsiblePersonIds ?? (team.trainerId ? [team.trainerId] : undefined)
    })),
    invitations: doc.invitations.map(embeddedInvitationToActivityInvitation),
    selectionSentAt: doc.selectionSentAt?.toISOString(),
    attendance: doc.attendance?.map(record => ({ ...record })),
    tasks: doc.tasks?.map(task => ({
      ...task,
      signups: task.signups.map(signup => ({
        personId: signup.personId,
        signedUpAt: signup.signedUpAt?.toISOString()
      })),
      isFulfilled: task.signups.length >= task.requiredPeople
    })),
    trainerIds: doc.trainerIds,
    groups: doc.groups
  };
}

export function eventToActivity(event: Event): Activity {
  const startsAt = new Date(`${event.date}T${event.teams.map(team => team.startTime).filter(value => /^\d{2}:\d{2}$/.test(value)).sort()[0] ?? '00:00'}:00.000Z`);
  return {
    id: event.id,
    squadId: event.groupId,
    kind: event.teams.length === 1 ? 'match' : 'tournament',
    name: event.name,
    startsAt: startsAt.toISOString(),
    location: event.location,
    matchFormatId: event.matchFormatId !== undefined ? event.matchFormatId : event.playingModeId,
    maxPlayersPerTeam: event.maxPlayersPerTeam,
    minPlayersPerTeam: event.minPlayersPerTeam,
    teams: event.teams,
    invitations: event.invitations.map(invitation => embeddedInvitationToActivityInvitation({
      id: invitation.id,
      playerId: invitation.playerId,
      status: invitation.status
    }))
  };
}

export function activityToEventDocument(activity: Activity): Omit<EventDocument, '_id' | 'createdAt' | 'updatedAt'> {
  const startsAt = new Date(activity.startsAt);
  const hasTeams = activity.kind === 'match' || activity.kind === 'tournament';
  const legacyEvent: Omit<Event, 'id'> = {
    groupId: activity.squadId,
    name: activity.name,
    date: startsAt.toISOString().slice(0, 10),
    maxPlayersPerTeam: activity.maxPlayersPerTeam ?? 0,
    minPlayersPerTeam: activity.minPlayersPerTeam ?? 0,
    location: activity.location,
    playingModeId: activity.matchFormatId,
    matchFormatId: activity.matchFormatId,
    teams: hasTeams ? activity.teams : [],
    invitations: activity.invitations.map(invitation => ({
      id: invitation.id,
      playerId: invitation.playerId,
      status: invitation.declineReason ?? invitation.response
    }))
  };
  return {
    ...eventToEventDocument(legacyEvent),
    kind: activity.kind,
    startsAt,
    endsAt: activity.endsAt ? new Date(activity.endsAt) : undefined,
    matchFormatId: activity.matchFormatId,
    opponentName: activity.opponentName,
    selectionSentAt: activity.selectionSentAt ? new Date(activity.selectionSentAt) : undefined,
    invitations: activity.invitations.map(activityInvitationToEmbedded),
    attendance: activity.attendance,
    tasks: activity.tasks?.map(task => ({
      id: task.id,
      name: task.name,
      description: task.description,
      requiredPeople: task.requiredPeople,
      signups: task.signups.map(signup => ({
        personId: signup.personId,
        signedUpAt: signup.signedUpAt ? new Date(signup.signedUpAt) : undefined
      }))
    })),
    trainerIds: activity.trainerIds,
    groups: activity.groups
  };
}

// Convert API Event to MongoDB EventDocument (for creation)
export function eventToEventDocument(event: Omit<Event, 'id'>): Omit<EventDocument, '_id' | 'createdAt' | 'updatedAt'> {
  const startsAt = new Date(`${event.date}T${event.teams.map(team => team.startTime).filter(value => /^\d{2}:\d{2}$/.test(value)).sort()[0] ?? '00:00'}:00.000Z`);
  return {
    name: event.name,
    eventDate: new Date(event.date),
    maxPlayersPerTeam: event.maxPlayersPerTeam,
    minPlayersPerTeam: event.minPlayersPerTeam,
    groupId: event.groupId,
    location: event.location,
    playingModeId: event.matchFormatId !== undefined ? event.matchFormatId : event.playingModeId,
    matchFormatId: event.matchFormatId !== undefined ? event.matchFormatId : event.playingModeId,
    kind: event.teams.length === 1 ? 'match' : 'tournament',
    startsAt,
    teams: event.teams.map(teamToEmbedded),
    invitations: event.invitations.map(invitationToEmbedded)
  };
}

// Convert MongoDB ShirtSetDocument to API ShirtSet
export function shirtSetDocumentToShirtSet(doc: ShirtSetDocument): ShirtSet {
  return {
    id: doc._id,
    groupId: doc.groupId,
    sponsor: doc.sponsor,
    color: doc.color,
    shirts: doc.shirts.map(shirt => ({
      ...shirt,
      status: shirt.status ?? 'available'
    }))
  };
}

// Convert API ShirtSet to MongoDB ShirtSetDocument (for creation)
export function shirtSetToShirtSetDocument(shirtSet: Omit<ShirtSet, 'id'>): Omit<ShirtSetDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    sponsor: shirtSet.sponsor,
    color: shirtSet.color,
    groupId: shirtSet.groupId,
    shirts: shirtSet.shirts.map(shirt => ({
      ...shirt,
      status: shirt.status ?? 'available'
    })),
    active: true
  };
}
