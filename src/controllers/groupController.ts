import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { Group } from '../types';
import { getNextSequence } from '../utils/sequence';
import { AuthRequest } from '../middleware/auth';

// GET /api/groups - Get all groups the authenticated user is a trainer in
export const getAllGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // User must be authenticated
    if (!req.user?.id) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Get the current user
    const user = await dataStore.getUserById(req.user.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Get all groups
    const allGroups = await dataStore.getAllGroups();

    // Filter groups: only return groups where user is a trainer member
    const userGroups: Group[] = [];

    for (const group of allGroups) {
      // Get all trainers in this group
      const trainers = await dataStore.getAllTrainers(group.id);

      // Check if user is a trainer in this group (by email match)
      const isTrainerInGroup = trainers.some(
        trainer => trainer.email && trainer.email.toLowerCase() === user.email.toLowerCase()
      );

      if (isTrainerInGroup) {
        userGroups.push(group);
      }
    }

    res.json(userGroups);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
};

// GET /api/groups/:id
export const getGroupById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const group = await dataStore.getGroupById(id);
    
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    
    res.json(group);
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
};

// POST /api/groups
export const createGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    
    const newGroup: Group = {
      id: await getNextSequence('groups'),
      name
    };
    
    const createdGroup = await dataStore.createGroup(newGroup);
    res.status(201).json(createdGroup);
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
};

// PUT /api/groups/:id
export const updateGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    
    const updatedGroup = await dataStore.updateGroup(id, { name });
    
    if (!updatedGroup) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    
    res.json(updatedGroup);
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
};

// DELETE /api/groups/:id
export const deleteGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const deleted = await dataStore.deleteGroup(id);
    
    if (!deleted) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
};