import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { Player, Trainer, Event, ShirtSet } from '../types';
import { getNextSequence } from '../utils/sequence';

// Interface for localStorage import data structure
interface LocalStorageData {
  players?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    birthYear: number;
    level: number;
  }>;
  trainers?: Array<{
    id: string;
    firstName: string;
    lastName: string;
  }>;
  events?: Array<{
    id: string;
    name: string;
    date: string;
    maxPlayersPerTeam: number;
    teams: Array<{
      id: string;
      name: string;
      strength: number;
      startTime: string;
      selectedPlayers: string[];
      trainerId?: string;
      shirtSetId?: string;
      shirtAssignments?: Array<{ playerId: string; shirtNumber: number }>;
    }>;
    invitations: Array<{
      id: string;
      playerId: string;
      status: 'open' | 'accepted' | 'declined';
    }>;
  }>;
  shirtSets?: Array<{
    id: string;
    sponsor: string;
    color: string;
    shirts: Array<{
      number: number;
      size: '128' | '140' | '152' | '164' | 'XS' | 'S' | 'M' | 'L' | 'XL';
      isGoalkeeper: boolean;
    }>;
  }>;
}

interface ImportSummary {
  playersImported: number;
  trainersImported: number;
  eventsImported: number;
  shirtSetsImported: number;
  errors: string[];
}

// POST /api/groups/:groupId/import
export const importLocalStorageData = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const data = req.body as LocalStorageData;

    if (!groupId) {
      res.status(400).json({ error: 'Group ID is required' });
      return;
    }

    // Verify group exists
    const group = await dataStore.getGroupById(groupId);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const summary: ImportSummary = {
      playersImported: 0,
      trainersImported: 0,
      eventsImported: 0,
      shirtSetsImported: 0,
      errors: []
    };

    // Create ID mapping for localStorage IDs to new sequence IDs
    const idMap = new Map<string, string>();

    // Import players
    if (data.players && Array.isArray(data.players)) {
      for (const playerData of data.players) {
        try {
          const newId = await getNextSequence('members');
          idMap.set(playerData.id, newId);

          const player: Player = {
            id: newId,
            groupId,
            firstName: playerData.firstName,
            lastName: playerData.lastName,
            birthYear: playerData.birthYear,
            level: playerData.level
          };

          await dataStore.createPlayer(player);
          summary.playersImported++;
        } catch (error) {
          summary.errors.push(`Failed to import player ${playerData.firstName} ${playerData.lastName}: ${error}`);
        }
      }
    }

    // Import trainers
    if (data.trainers && Array.isArray(data.trainers)) {
      for (const trainerData of data.trainers) {
        try {
          const newId = await getNextSequence('members');
          idMap.set(trainerData.id, newId);

          const trainer: Trainer = {
            id: newId,
            groupId,
            firstName: trainerData.firstName,
            lastName: trainerData.lastName
          };

          await dataStore.createTrainer(trainer);
          summary.trainersImported++;
        } catch (error) {
          summary.errors.push(`Failed to import trainer ${trainerData.firstName} ${trainerData.lastName}: ${error}`);
        }
      }
    }

    // Import shirt sets
    if (data.shirtSets && Array.isArray(data.shirtSets)) {
      for (const shirtSetData of data.shirtSets) {
        try {
          const newId = await getNextSequence('shirtsets');
          idMap.set(shirtSetData.id, newId);

          const shirtSet: ShirtSet = {
            id: newId,
            groupId,
            sponsor: shirtSetData.sponsor,
            color: shirtSetData.color,
            shirts: shirtSetData.shirts
          };

          await dataStore.createShirtSet(shirtSet);
          summary.shirtSetsImported++;
        } catch (error) {
          summary.errors.push(`Failed to import shirt set ${shirtSetData.sponsor} ${shirtSetData.color}: ${error}`);
        }
      }
    }

    // Import events (must be last to resolve player/trainer/shirtset references)
    if (data.events && Array.isArray(data.events)) {
      for (const eventData of data.events) {
        try {
          const newEventId = await getNextSequence('events');
          
          // Map team IDs and update player/trainer references
          const updatedTeams = await Promise.all(eventData.teams.map(async (team) => {
            const newTeamId = await getNextSequence('teams');
            idMap.set(team.id, newTeamId);

            return {
              id: newTeamId,
              name: team.name,
              strength: team.strength,
              startTime: team.startTime,
              selectedPlayers: team.selectedPlayers.map(playerId => idMap.get(playerId) || playerId),
              trainerId: team.trainerId ? idMap.get(team.trainerId) : undefined,
              shirtSetId: team.shirtSetId ? idMap.get(team.shirtSetId) : undefined,
              shirtAssignments: team.shirtAssignments?.map(assignment => ({
                playerId: idMap.get(assignment.playerId) || assignment.playerId,
                shirtNumber: assignment.shirtNumber
              }))
            };
          }));

          // Map invitation IDs and update player references
          const updatedInvitations = await Promise.all(eventData.invitations.map(async (invitation) => {
            const newInvitationId = await getNextSequence('invitations');
            return {
              id: newInvitationId,
              playerId: idMap.get(invitation.playerId) || invitation.playerId,
              status: invitation.status
            };
          }));

          const event: Event = {
            id: newEventId,
            groupId,
            name: eventData.name,
            date: eventData.date,
            maxPlayersPerTeam: eventData.maxPlayersPerTeam,
            teams: updatedTeams,
            invitations: updatedInvitations
          };

          await dataStore.createEvent(event);
          summary.eventsImported++;
        } catch (error) {
          summary.errors.push(`Failed to import event ${eventData.name}: ${error}`);
        }
      }
    }

    res.status(200).json({
      message: 'Import completed',
      summary,
      groupId
    });

  } catch (error) {
    console.error('Error importing localStorage data:', error);
    res.status(500).json({ error: 'Failed to import data' });
  }
};