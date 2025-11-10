// Base MongoDB document interface
export interface BaseDocument {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
}

// Groups Collection
export interface GroupDocument extends BaseDocument {
  name: string;
}

// Members Collection - Unified collection for players and trainers
export interface PersonDocument extends BaseDocument {
  firstName: string;
  lastName: string;
  role: 'player' | 'trainer';
  groupId: string; // Reference to GroupDocument
  // Player-specific properties (only present when role === 'player')
  birthYear?: number;
  level?: number; // 1-5
}

// Embedded invitation document (within events)
export interface InvitationEmbedded {
  id: string;
  playerId: string; // Reference to PersonDocument with role 'player'
  status: 'open' | 'accepted' | 'declined';
  sentAt?: Date;
  respondedAt?: Date;
}

// Embedded shirt assignment (within teams)
export interface ShirtAssignmentEmbedded {
  playerId: string; // Reference to PersonDocument with role 'player'
  shirtNumber: number;
}

// Embedded team document (within events)
export interface TeamEmbedded {
  id: string;
  name: string;
  strength: number; // 1 (highest) to 3 (lowest), default 2
  startTime: string; // HH:MM format
  selectedPlayers: string[]; // References to PersonDocument with role 'player'
  trainerId?: string; // Reference to PersonDocument with role 'trainer'
  shirtSetId?: string; // Reference to ShirtSetDocument
  shirtAssignments?: ShirtAssignmentEmbedded[];
}

// Events Collection
export interface EventDocument extends BaseDocument {
  name: string;
  eventDate: Date; // Using Date instead of string for better MongoDB operations
  maxPlayersPerTeam: number;
  groupId: string; // Reference to GroupDocument
  teams: TeamEmbedded[];
  invitations: InvitationEmbedded[];
}

// Embedded shirt document (within shirt sets)
export interface ShirtEmbedded {
  number: number;
  size: '128' | '140' | '152' | '164' | 'XS' | 'S' | 'M' | 'L' | 'XL';
  isGoalkeeper: boolean;
}

// Shirt Sets Collection
export interface ShirtSetDocument extends BaseDocument {
  sponsor: string;
  color: string;
  groupId: string; // Reference to GroupDocument
  shirts: ShirtEmbedded[];
  active: boolean; // For soft deletion
}

// Helper types for queries and operations
export type PlayerDocument = PersonDocument & {
  role: 'player';
  birthYear: number;
  level: number;
};

export type TrainerDocument = PersonDocument & {
  role: 'trainer';
};

// Type guards for runtime type checking
export function isPlayerDocument(person: PersonDocument): person is PlayerDocument {
  return person.role === 'player' && 
         typeof person.birthYear === 'number' && 
         typeof person.level === 'number';
}

export function isTrainerDocument(person: PersonDocument): person is TrainerDocument {
  return person.role === 'trainer';
}

// Collection names constants
export const COLLECTIONS = {
  GROUPS: 'groups',
  MEMBERS: 'members',
  EVENTS: 'events',
  SHIRT_SETS: 'shirt-sets'
} as const;

export type CollectionName = typeof COLLECTIONS[keyof typeof COLLECTIONS];