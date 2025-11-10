import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { Player, Trainer } from '../types';
import { getNextSequence } from '../utils/sequence';

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
      res.json(trainers);
    } else if (!role) {
      // Return both players and trainers
      const [players, trainers] = await Promise.all([
        dataStore.getAllPlayers(groupId),
        dataStore.getAllTrainers(groupId)
      ]);
      res.json({
        players,
        trainers
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
      res.json({ ...trainer, role: 'trainer' });
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
    const { role, firstName, lastName, birthYear, level } = req.body;
    
    if (!role || !firstName || !lastName) {
      res.status(400).json({ error: 'role, firstName, and lastName are required' });
      return;
    }
    
    if (!['player', 'trainer'].includes(role)) {
      res.status(400).json({ error: 'role must be "player" or "trainer"' });
      return;
    }
    
    if (role === 'player') {
      if (typeof birthYear !== 'number' || typeof level !== 'number') {
        res.status(400).json({ error: 'birthYear and level are required for players' });
        return;
      }
      
      if (level < 1 || level > 5) {
        res.status(400).json({ error: 'Player level must be between 1 and 5' });
        return;
      }
      
      const newPlayer: Player = {
        id: await getNextSequence('members'),
        groupId,
        firstName,
        lastName,
        birthYear,
        level
      };
      
      const createdPlayer = await dataStore.createPlayer(newPlayer);
      res.status(201).json({ ...createdPlayer, role: 'player' });
    } else {
      const newTrainer: Trainer = {
        id: await getNextSequence('members'),
        groupId,
        firstName,
        lastName
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
    const { role, firstName, lastName, birthYear, level } = req.body;
    
    if (!role || !firstName || !lastName) {
      res.status(400).json({ error: 'role, firstName, and lastName are required' });
      return;
    }
    
    if (!['player', 'trainer'].includes(role)) {
      res.status(400).json({ error: 'role must be "player" or "trainer"' });
      return;
    }
    
    if (role === 'player') {
      if (typeof birthYear !== 'number' || typeof level !== 'number') {
        res.status(400).json({ error: 'birthYear and level are required for players' });
        return;
      }
      
      if (level < 1 || level > 5) {
        res.status(400).json({ error: 'Player level must be between 1 and 5' });
        return;
      }
      
      const updatedPlayer = await dataStore.updatePlayer(id, {
        firstName,
        lastName,
        birthYear,
        level
      });
      
      if (!updatedPlayer) {
        res.status(404).json({ error: 'Player not found' });
        return;
      }
      
      res.json({ ...updatedPlayer, role: 'player' });
    } else {
      const updatedTrainer = await dataStore.updateTrainer(id, {
        firstName,
        lastName
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
    
    const trainerDeleted = await dataStore.deleteTrainer(id);
    if (trainerDeleted) {
      res.status(204).send();
      return;
    }
    
    res.status(404).json({ error: 'Member not found' });
  } catch (error) {
    console.error('Error deleting member:', error);
    res.status(500).json({ error: 'Failed to delete member' });
  }
};