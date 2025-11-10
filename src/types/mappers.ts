import type { 
  GroupDocument,
  PersonDocument, 
  EventDocument, 
  ShirtSetDocument,
  TeamEmbedded,
  InvitationEmbedded
} from './mongodb';
import type { 
  Group,
  Player, 
  Trainer, 
  Event, 
  ShirtSet, 
  Team, 
  Invitation 
} from './index';

// Convert MongoDB GroupDocument to API Group
export function groupDocumentToGroup(doc: GroupDocument): Group {
  return {
    id: doc._id,
    name: doc.name,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString()
  };
}

// Convert API Group to MongoDB GroupDocument (for create operations)
export function groupToGroupDocument(group: Group): Omit<GroupDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    name: group.name
  };
}

// Convert MongoDB PersonDocument to API Player
export function personDocumentToPlayer(doc: PersonDocument): Player | null {
  if (doc.role !== 'player' || !doc.birthYear || !doc.level) {
    return null;
  }
  
  return {
    id: doc._id,
    groupId: doc.groupId,
    firstName: doc.firstName,
    lastName: doc.lastName,
    birthYear: doc.birthYear,
    level: doc.level
  };
}

// Convert MongoDB PersonDocument to API Trainer
export function personDocumentToTrainer(doc: PersonDocument): Trainer | null {
  if (doc.role !== 'trainer') {
    return null;
  }
  
  return {
    id: doc._id,
    groupId: doc.groupId,
    firstName: doc.firstName,
    lastName: doc.lastName
  };
}

// Convert API Player to MongoDB PersonDocument (for create operations)
export function playerToPersonDocument(player: Player): Omit<PersonDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    firstName: player.firstName,
    lastName: player.lastName,
    role: 'player',
    groupId: player.groupId,
    birthYear: player.birthYear,
    level: player.level
  };
}

// Convert API Trainer to MongoDB PersonDocument (for create operations)
export function trainerToPersonDocument(trainer: Trainer): Omit<PersonDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    firstName: trainer.firstName,
    lastName: trainer.lastName,
    role: 'trainer',
    groupId: trainer.groupId
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
  return {
    id: invitation.id,
    playerId: invitation.playerId,
    status: invitation.status,
    sentAt: new Date(),
    respondedAt: invitation.status !== 'open' ? new Date() : undefined
  };
}

// Convert embedded team from MongoDB to API format
export function embeddedTeamToTeam(embedded: TeamEmbedded): Team {
  return {
    id: embedded.id,
    name: embedded.name,
    strength: embedded.strength,
    startTime: embedded.startTime,
    selectedPlayers: embedded.selectedPlayers,
    trainerId: embedded.trainerId,
    shirtSetId: embedded.shirtSetId,
    shirtAssignments: embedded.shirtAssignments?.map(assignment => ({
      playerId: assignment.playerId,
      shirtNumber: assignment.shirtNumber
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
    selectedPlayers: team.selectedPlayers,
    trainerId: team.trainerId,
    shirtSetId: team.shirtSetId,
    shirtAssignments: team.shirtAssignments?.map(assignment => ({
      playerId: assignment.playerId,
      shirtNumber: assignment.shirtNumber
    }))
  };
}

// Convert MongoDB EventDocument to API Event
export function eventDocumentToEvent(doc: EventDocument): Event {
  return {
    id: doc._id,
    groupId: doc.groupId,
    name: doc.name,
    date: doc.eventDate.toISOString().split('T')[0], // Convert Date to ISO string
    maxPlayersPerTeam: doc.maxPlayersPerTeam,
    teams: doc.teams.map(embeddedTeamToTeam),
    invitations: doc.invitations.map(embeddedInvitationToInvitation)
  };
}

// Convert API Event to MongoDB EventDocument (for creation)
export function eventToEventDocument(event: Omit<Event, 'id'>): Omit<EventDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    name: event.name,
    eventDate: new Date(event.date),
    maxPlayersPerTeam: event.maxPlayersPerTeam,
    groupId: event.groupId,
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
    shirts: doc.shirts // Shirts are embedded and have the same structure
  };
}

// Convert API ShirtSet to MongoDB ShirtSetDocument (for creation)
export function shirtSetToShirtSetDocument(shirtSet: Omit<ShirtSet, 'id'>): Omit<ShirtSetDocument, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    sponsor: shirtSet.sponsor,
    color: shirtSet.color,
    groupId: shirtSet.groupId,
    shirts: shirtSet.shirts, // Shirts have the same structure
    active: true
  };
}