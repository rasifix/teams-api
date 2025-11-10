import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import type { ShirtSet } from '../types';
import { getNextSequence } from '../utils/sequence';

// GET /api/groups/:groupId/shirtsets
export const getShirtSets = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const shirtSets = await dataStore.getAllShirtSets(groupId);
    res.json(shirtSets);
  } catch (error) {
    console.error('Error fetching shirt sets:', error);
    res.status(500).json({ message: 'Failed to fetch shirt sets' });
  }
};

// GET /api/shirt-sets/:id
export const getShirtSetById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const shirtSet = await dataStore.getShirtSetById(id);
    
    if (!shirtSet) {
      res.status(404).json({ message: 'Shirt set not found' });
      return;
    }
    
    res.json(shirtSet);
  } catch (error) {
    console.error('Error fetching shirt set:', error);
    res.status(500).json({ message: 'Failed to fetch shirt set' });
  }
};

// POST /api/shirt-sets
export const createShirtSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const { sponsor, color, shirts } = req.body;
    
    if (!sponsor || !color || !Array.isArray(shirts)) {
      res.status(400).json({ message: 'sponsor, color, and shirts array are required' });
      return;
    }
    
    const newShirtSet: ShirtSet = {
      id: await getNextSequence('shirtsets'),
      groupId,
      sponsor,
      color,
      shirts,
    };
    
    const createdShirtSet = await dataStore.createShirtSet(newShirtSet);
    res.status(201).json(createdShirtSet);
  } catch (error) {
    console.error('Error creating shirt set:', error);
    res.status(500).json({ message: 'Failed to create shirt set' });
  }
};

// PUT /api/shirt-sets/:id
export const updateShirtSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { sponsor, color, shirts } = req.body;
    
    if (!sponsor || !color || !Array.isArray(shirts)) {
      res.status(400).json({ message: 'sponsor, color, and shirts array are required' });
      return;
    }
    
    const updatedShirtSet = await dataStore.updateShirtSet(id, { sponsor, color, shirts });
    
    if (!updatedShirtSet) {
      res.status(404).json({ message: 'Shirt set not found' });
      return;
    }
    
    res.json(updatedShirtSet);
  } catch (error) {
    console.error('Error updating shirt set:', error);
    res.status(500).json({ message: 'Failed to update shirt set' });
  }
};

// DELETE /api/shirt-sets/:id
export const deleteShirtSet = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const success = await dataStore.deleteShirtSet(id);
    
    if (!success) {
      res.status(404).json({ message: 'Shirt set not found' });
      return;
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting shirt set:', error);
    res.status(500).json({ message: 'Failed to delete shirt set' });
  }
};