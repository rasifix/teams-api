// Base MongoDB document interface
export interface BaseDocument {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
}

// Groups Collection
export interface GroupDocument extends BaseDocument {
  name: string;
  club?: string;
}

// Embedded evaluation document (within player documents)
export interface EvaluationEmbedded {
  id: string;
  playerId: string; // Reference to PersonDocument with role 'player'
  evaluationDate: string; // ISO date string (YYYY-MM-DD)
  userId: string; // Reference to UserDocument (trainer who created the evaluation)
  score: {
    technical: number; // 1-5
    intelligence: number; // 1-5
    personality: number; // 1-5
    speed: number; // 1-5
  };
  comments?: string;
  createdAt: Date;
}

// Members Collection - Unified collection for players and trainers
export interface PersonDocument extends BaseDocument {
  firstName?: string;
  lastName?: string;
  role: 'player' | 'trainer';
  groupId: string; // Reference to GroupDocument
  email?: string; // Optional email for trainers
  // Player-specific properties (only present when role === 'player')
  birthYear?: number;
  birthDate?: string; // ISO date string (YYYY-MM-DD)
  level?: number; // 1-5
  evaluations?: EvaluationEmbedded[]; // Player evaluations (only present when role === 'player')
}

// Embedded invitation document (within events)
export interface InvitationEmbedded {
  id: string;
  playerId: string; // Reference to PersonDocument with role 'player'
  status: 'open' | 'accepted' | 'declined' | 'injured';
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
  location?: string; // Optional location field
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
  birthDate?: string;
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

// Users Collection
export interface UserDocument extends BaseDocument {
  email: string;
  password: string; // Hashed password
  firstName?: string;
  lastName?: string;
}

// Password Reset Collection
export interface PasswordResetDocument extends BaseDocument {
  email: string;
  resetToken: string; // Random token for verification
  expiresAt: Date;
  used: boolean;
}

// Collection names constants
export const COLLECTIONS = {
  GROUPS: 'groups',
  MEMBERS: 'members',
  EVENTS: 'events',
  SHIRT_SETS: 'shirt-sets',
  USERS: 'users',
  PASSWORD_RESETS: 'password-resets'
} as const;

export type CollectionName = typeof COLLECTIONS[keyof typeof COLLECTIONS];