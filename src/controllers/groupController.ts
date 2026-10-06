import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { GROUP_CATEGORIES, Group, GroupCategory, Trainer } from '../types';
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
      const groupAccess = await dataStore.getUserGroupAccess(user.id, group.id);
      if (groupAccess) {
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
export const createGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // User must be authenticated
    if (!req.user?.id) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Get the current user that will be added as trainer
    const user = await dataStore.getUserById(req.user.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const { name, club, category } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (category !== undefined && !GROUP_CATEGORIES.includes(category as GroupCategory)) {
      res.status(400).json({ error: `category must be one of: ${GROUP_CATEGORIES.join(', ')}` });
      return;
    }
    
    const newGroup: Group = {
      id: await getNextSequence('groups'),
      name,
      club,
      category
    };
    
    const createdGroup = await dataStore.createGroup(newGroup);

    const trainerMember: Trainer = {
      id: await getNextSequence('members'),
      groupId: createdGroup.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email.toLowerCase(),
      roles: ['admin', 'trainer']
    };

    try {
      await dataStore.createTrainer(trainerMember);
    } catch (trainerError) {
      // Avoid orphan groups when automatic trainer creation fails.
      await dataStore.deleteGroup(createdGroup.id);
      throw trainerError;
    }

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
    const { name, club, category, matchPlanningEnabled } = req.body;

    const hasNoUpdatableFields =
      name === undefined &&
      club === undefined &&
      category === undefined &&
      matchPlanningEnabled === undefined;
    if (hasNoUpdatableFields) {
      res.status(400).json({ error: 'At least one of name, club, category, or matchPlanningEnabled is required' });
      return;
    }

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      res.status(400).json({ error: 'name must be a non-empty string when provided' });
      return;
    }

    if (matchPlanningEnabled !== undefined && typeof matchPlanningEnabled !== 'boolean') {
      res.status(400).json({ error: 'matchPlanningEnabled must be a boolean when provided' });
      return;
    }

    if (category !== undefined && !GROUP_CATEGORIES.includes(category as GroupCategory)) {
      res.status(400).json({ error: `category must be one of: ${GROUP_CATEGORIES.join(', ')}` });
      return;
    }

    const updates: Partial<Pick<Group, 'name' | 'club' | 'category' | 'matchPlanningEnabled'>> = {};
    if (name !== undefined) updates.name = name.trim();
    if (club !== undefined) updates.club = club;
    if (category !== undefined) updates.category = category;
    if (matchPlanningEnabled !== undefined) updates.matchPlanningEnabled = matchPlanningEnabled;

    const updatedGroup = await dataStore.updateGroup(id, updates);
    
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
