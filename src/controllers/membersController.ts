import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { Guardian, Player, Trainer } from '../types';
import { getNextSequence } from '../utils/sequence';

// Helper function to populate trainer names and email from User if not present
async function populateTrainerNames(trainer: Trainer): Promise<Trainer> {
  if (trainer.email && ((!trainer.firstName || !trainer.lastName))) {
    const user = await dataStore.getUserByEmail(trainer.email);
    if (user) {
      return {
        ...trainer,
        firstName: trainer.firstName || user.firstName,
        lastName: trainer.lastName || user.lastName
      };
    }
  }
  return trainer;
}

// GET /api/groups/:groupId/members?role=player|trainer or GET /api/groups/:groupId/members (returns all)
export const getAllMembers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const { role } = req.query;
    
    if (role === 'player') {
      const players = await dataStore.getAllPlayers(groupId);
      res.json(players);
    } else if (role === 'trainer') {
      const trainers = await dataStore.getAllTrainers(groupId);
      // Populate trainer names from User
      const populatedTrainers = await Promise.all(
        trainers.map(trainer => populateTrainerNames(trainer))
      );
      res.json(populatedTrainers);
    } else if (!role) {
      // Return both players and trainers
      const [players, trainers] = await Promise.all([
        dataStore.getAllPlayers(groupId),
        dataStore.getAllTrainers(groupId)
      ]);
      // Populate trainer names from User
      const populatedTrainers = await Promise.all(
        trainers.map(trainer => populateTrainerNames(trainer))
      );
      res.json({
        players,
        trainers: populatedTrainers
      });
    } else {
      res.status(400).json({ error: 'Invalid role. Must be "player" or "trainer"' });
    }
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
};

// GET /api/members/:id
export const getMemberById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Try to find as player first, then as trainer
    const player = await dataStore.getPlayerById(id);
    if (player) {
      res.json({ ...player, role: 'player' });
      return;
    }
    
    const trainer = await dataStore.getTrainerById(id);
    if (trainer) {
      const populatedTrainer = await populateTrainerNames(trainer);
      res.json({ ...populatedTrainer, role: 'trainer' });
      return;
    }
    
    res.status(404).json({ error: 'Member not found' });
  } catch (error) {
    console.error('Error fetching member:', error);
    res.status(500).json({ error: 'Failed to fetch member' });
  }
};

// POST /api/groups/:groupId/members
export const createMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const { role, firstName, lastName, birthDate, level, email, preferredShirtNumber, status } = req.body;
    
    if (!role) {
      res.status(400).json({ error: 'role is required' });
      return;
    }
    
    if (!['player', 'trainer'].includes(role)) {
      res.status(400).json({ error: 'role must be "player" or "trainer"' });
      return;
    }
    
    if (role === 'player') {
      if (!firstName || !lastName) {
        res.status(400).json({ error: 'firstName and lastName are required for players' });
        return;
      }
      if (typeof birthDate !== 'string' || typeof level !== 'number') {
        res.status(400).json({ error: 'birthDate and level are required for players' });
        return;
      }
      
      if (level < 1 || level > 5) {
        res.status(400).json({ error: 'Player level must be between 1 and 5' });
        return;
      }

      if (preferredShirtNumber !== undefined && (!Number.isInteger(preferredShirtNumber) || preferredShirtNumber < 1)) {
        res.status(400).json({ error: 'preferredShirtNumber must be an integer greater than or equal to 1' });
        return;
      }

      if (status !== undefined && !['active', 'trial', 'inactive'].includes(status)) {
        res.status(400).json({ error: 'status must be one of "active", "trial", or "inactive"' });
        return;
      }
      
      const newPlayer: Player = {
        id: await getNextSequence('members'),
        groupId,
        firstName,
        lastName,
        birthDate,
        level,
        preferredShirtNumber,
        status: status ?? 'active'
      };
      
      const createdPlayer = await dataStore.createPlayer(newPlayer);
      res.status(201).json({ ...createdPlayer, role: 'player' });
    } else {
      // For trainers, validate email exists in users if provided
      if (email) {
        const linkedUser = await dataStore.getUserByEmail(email);
        if (!linkedUser) {
          res.status(400).json({ error: 'Email not found in users' });
          return;
        }
      }
      
      // For trainers, firstName and lastName are optional (can be populated from User)
      const newTrainer: Trainer = {
        id: await getNextSequence('members'),
        groupId,
        firstName,
        lastName,
        email: email ? email.toLowerCase() : undefined
      };
      
      const createdTrainer = await dataStore.createTrainer(newTrainer);
      res.status(201).json({ ...createdTrainer, role: 'trainer' });
    }
  } catch (error) {
    console.error('Error creating member:', error);
    res.status(500).json({ error: 'Failed to create member' });
  }
};

// PUT /api/members/:id
export const updateMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role, firstName, lastName, birthDate, level, email, preferredShirtNumber, status } = req.body;
    
    if (!role) {
      res.status(400).json({ error: 'role is required' });
      return;
    }
    
    if (!['player', 'trainer'].includes(role)) {
      res.status(400).json({ error: 'role must be "player" or "trainer"' });
      return;
    }
    
    if (role === 'player') {
      if (!firstName || !lastName) {
        res.status(400).json({ error: 'firstName and lastName are required for players' });
        return;
      }
      if (typeof birthDate !== 'string' || typeof level !== 'number') {
        res.status(400).json({ error: 'birthDate and level are required for players' });
        return;
      }
      
      if (level < 1 || level > 5) {
        res.status(400).json({ error: 'Player level must be between 1 and 5' });
        return;
      }

      if (preferredShirtNumber !== undefined && (!Number.isInteger(preferredShirtNumber) || preferredShirtNumber < 1)) {
        res.status(400).json({ error: 'preferredShirtNumber must be an integer greater than or equal to 1' });
        return;
      }

      if (status !== undefined && !['active', 'trial', 'inactive'].includes(status)) {
        res.status(400).json({ error: 'status must be one of "active", "trial", or "inactive"' });
        return;
      }
      
      const updatedPlayer = await dataStore.updatePlayer(id, {
        firstName,
        lastName,
        birthDate,
        level,
        preferredShirtNumber,
        status
      });
      
      if (!updatedPlayer) {
        res.status(404).json({ error: 'Player not found' });
        return;
      }
      
      res.json({ ...updatedPlayer, role: 'player' });
    } else {
      // For trainers, validate email exists in users if provided
      if (email) {
        const linkedUser = await dataStore.getUserByEmail(email);
        if (!linkedUser) {
          res.status(400).json({ error: 'Email not found in users' });
          return;
        }
      }
      
      // For trainers, firstName and lastName are optional
      const updatedTrainer = await dataStore.updateTrainer(id, {
        firstName,
        lastName,
        email: email ? email.toLowerCase() : undefined
      });
      
      if (!updatedTrainer) {
        res.status(404).json({ error: 'Trainer not found' });
        return;
      }
      
      res.json({ ...updatedTrainer, role: 'trainer' });
    }
  } catch (error) {
    console.error('Error updating member:', error);
    res.status(500).json({ error: 'Failed to update member' });
  }
};

// POST /api/groups/:groupId/members/:id/guardians
export const addGuardianToPlayer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const guardian = req.body as Partial<Guardian>;

    if (typeof guardian !== 'object' || guardian === null) {
      res.status(400).json({ error: 'guardian payload is required' });
      return;
    }

    if (guardian.id !== undefined) {
      res.status(400).json({ error: 'guardian id must not be provided; it is generated by the backend' });
      return;
    }

    const hasInvalidShape =
      (guardian.firstName !== undefined && typeof guardian.firstName !== 'string') ||
      (guardian.lastName !== undefined && typeof guardian.lastName !== 'string') ||
      (guardian.email !== undefined && typeof guardian.email !== 'string');

    if (hasInvalidShape) {
      res.status(400).json({ error: 'guardian may include firstName, lastName, and email' });
      return;
    }

    const player = await dataStore.getPlayerById(id);
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    const currentGuardians = player.guardians ?? [];
    const normalizedGuardianEmail = guardian.email?.toLowerCase();
    if (
      normalizedGuardianEmail &&
      currentGuardians.some(existingGuardian => existingGuardian.email?.toLowerCase() === normalizedGuardianEmail)
    ) {
      res.status(409).json({ error: 'Guardian already exists' });
      return;
    }

    const guardianId = await getNextSequence('members');
    const guardianGroupId = player.groupId;

    const newGuardian: Guardian = {
      id: guardianId,
      groupId: guardianGroupId,
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      email: normalizedGuardianEmail
    };

    const updatedPlayer = await dataStore.updatePlayer(id, {
      guardians: [
        ...currentGuardians,
        newGuardian
      ]
    });

    if (!updatedPlayer) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json({ ...updatedPlayer, role: 'player' });
  } catch (error) {
    console.error('Error adding guardian:', error);
    res.status(500).json({ error: 'Failed to add guardian' });
  }
};

// DELETE /api/groups/:groupId/members/:id/guardians/:guardianId
export const deleteGuardianFromPlayer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, guardianId } = req.params;

    const player = await dataStore.getPlayerById(id);
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    const currentGuardians = player.guardians ?? [];
    const updatedGuardians = currentGuardians.filter(guardian => guardian.id !== guardianId);

    if (updatedGuardians.length === currentGuardians.length) {
      res.status(404).json({ error: 'Guardian not found' });
      return;
    }

    const updatedPlayer = await dataStore.updatePlayer(id, { guardians: updatedGuardians });
    if (!updatedPlayer) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json({ ...updatedPlayer, role: 'player' });
  } catch (error) {
    console.error('Error deleting guardian:', error);
    res.status(500).json({ error: 'Failed to delete guardian' });
  }
};

// DELETE /api/members/:id
export const deleteMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Try to delete as player first, then as trainer
    const playerDeleted = await dataStore.deletePlayer(id);
    if (playerDeleted) {
      res.status(204).send();
      return;
    }
    
    const trainerDeleteResult = await dataStore.deleteTrainer(id);
    if (trainerDeleteResult.deleted) {
      res.status(204).send();
      return;
    }

    if (trainerDeleteResult.reason === 'last-admin') {
      res.status(409).json({ error: 'Cannot delete the last admin in a group' });
      return;
    }
    
    res.status(404).json({ error: 'Member not found' });
  } catch (error) {
    console.error('Error deleting member:', error);
    res.status(500).json({ error: 'Failed to delete member' });
  }
};