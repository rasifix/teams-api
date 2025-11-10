export interface Player {
  id: string;
  groupId: string;
  firstName: string;
  lastName: string;
  birthYear: number;
  level: number; // 1-5
}

export interface Trainer {
  id: string;
  groupId: string;
  firstName: string;
  lastName: string;
}

export interface Group {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Invitation {
  id: string;
  playerId: string;
  status: 'open' | 'accepted' | 'declined';
}

export interface Team {
  id: string;
  name: string;
  strength: number; // 1 (highest) to 3 (lowest), default 2
  startTime: string; // HH:MM format - each team can have different start times
  selectedPlayers: string[]; // Player IDs assigned to this team
  trainerId?: string; // Trainer ID assigned to this team
  shirtSetId?: string; // Shirt set ID assigned to this team
  shirtAssignments?: Array<{ playerId: string; shirtNumber: number }>; // Individual shirt assignments by number
}

export interface Event {
  id: string;
  groupId: string;
  name: string;
  date: string; // ISO date string
  maxPlayersPerTeam: number; // Max players applies to all teams in this event
  teams: Team[]; // Teams are contained within the event
  invitations: Invitation[];
}

export interface Shirt {
  number: number;
  size: '128' | '140' | '152' | '164' | 'XS' | 'S' | 'M' | 'L' | 'XL';
  isGoalkeeper: boolean;
}

export interface ShirtSet {
  id: string;
  groupId: string;
  sponsor: string;
  color: string;
  shirts: Shirt[];
}

export interface Trainer {
  id: string;
  firstName: string;
  lastName: string;
}
