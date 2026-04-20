import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import type { ShirtSet } from '../types';
import { getNextSequence } from '../utils/sequence';

const SHIRT_STATUSES = ['available', 'unavailable'] as const;

const normalizeShirts = (shirts: ShirtSet['shirts']): ShirtSet['shirts'] => {
  return shirts.map(shirt => ({
    ...shirt,
    status: shirt.status ?? 'available'
  }));
};

const isValidShirtStatus = (status: unknown): status is (typeof SHIRT_STATUSES)[number] => {
  return typeof status === 'string' && SHIRT_STATUSES.includes(status as (typeof SHIRT_STATUSES)[number]);
};

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
      shirts: normalizeShirts(shirts),
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
    
    const updatedShirtSet = await dataStore.updateShirtSet(id, {
      sponsor,
      color,
      shirts: normalizeShirts(shirts)
    });
    
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

// PUT /api/groups/:groupId/shirtsets/:id/shirts/:shirtNumber/status
export const updateShirtStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, shirtNumber } = req.params;
    const { status } = req.body;

    if (!isValidShirtStatus(status)) {
      res.status(400).json({ message: 'Invalid shirt status. Allowed values: available, unavailable' });
      return;
    }

    const shirtNumberAsInt = Number.parseInt(shirtNumber, 10);
    if (Number.isNaN(shirtNumberAsInt)) {
      res.status(400).json({ message: 'shirtNumber must be a number' });
      return;
    }

    const shirtSet = await dataStore.getShirtSetById(id);
    if (!shirtSet) {
      res.status(404).json({ message: 'Shirt set not found' });
      return;
    }

    const hasShirt = shirtSet.shirts.some(shirt => shirt.number === shirtNumberAsInt);
    if (!hasShirt) {
      res.status(404).json({ message: 'Shirt not found in shirt set' });
      return;
    }

    const updatedShirts = shirtSet.shirts.map(shirt =>
      shirt.number === shirtNumberAsInt
        ? { ...shirt, status }
        : shirt
    );

    const updatedShirtSet = await dataStore.updateShirtSet(id, { shirts: updatedShirts });
    if (!updatedShirtSet) {
      res.status(404).json({ message: 'Shirt set not found' });
      return;
    }

    res.json(updatedShirtSet);
  } catch (error) {
    console.error('Error updating shirt status:', error);
    res.status(500).json({ message: 'Failed to update shirt status' });
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