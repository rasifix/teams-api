import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { Group } from '../types';
import { getNextSequence } from '../utils/sequence';

// GET /api/groups
export const getAllGroups = async (_req: Request, res: Response): Promise<void> => {
  try {
    const groups = await dataStore.getAllGroups();
    res.json(groups);
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