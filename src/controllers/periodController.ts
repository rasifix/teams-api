import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import type { Period } from '../types';
import { getNextSequence } from '../utils/sequence';

function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().startsWith(value);
}

function validatePeriodShape(period: Pick<Period, 'name' | 'startDate' | 'endDate'>): string | null {
  if (!period.name.trim()) {
    return 'name is required';
  }

  if (!isValidDateString(period.startDate) || !isValidDateString(period.endDate)) {
    return 'startDate and endDate must be valid ISO dates in YYYY-MM-DD format';
  }

  if (period.startDate > period.endDate) {
    return 'startDate must be before or equal to endDate';
  }

  return null;
}

// GET /api/groups/:groupId/periods
export const getPeriods = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const periods = await dataStore.getGroupPeriods(groupId);

    if (periods === null) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    res.json(periods);
  } catch (error) {
    console.error('Error fetching periods:', error);
    res.status(500).json({ error: 'Failed to fetch periods' });
  }
};

// POST /api/groups/:groupId/periods
export const createPeriod = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const { name, startDate, endDate } = req.body;

    const normalizedPeriod = {
      name: typeof name === 'string' ? name.trim() : '',
      startDate,
      endDate
    };

    const validationError = validatePeriodShape(normalizedPeriod);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const newPeriod: Period = {
      id: await getNextSequence('periods'),
      ...normalizedPeriod
    };

    const createdPeriod = await dataStore.addPeriodToGroup(groupId, newPeriod);

    if (!createdPeriod) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    res.status(201).json(createdPeriod);
  } catch (error) {
    console.error('Error creating period:', error);
    res.status(500).json({ error: 'Failed to create period' });
  }
};

// PUT /api/groups/:groupId/periods/:periodId
export const updatePeriod = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, periodId } = req.params;
    const { name, startDate, endDate } = req.body;

    if (name === undefined && startDate === undefined && endDate === undefined) {
      res.status(400).json({ error: 'At least one of name, startDate, or endDate is required' });
      return;
    }

    const periods = await dataStore.getGroupPeriods(groupId);
    if (periods === null) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const existingPeriod = periods.find(period => period.id === periodId);
    if (!existingPeriod) {
      res.status(404).json({ error: 'Period not found' });
      return;
    }

    const mergedPeriod = {
      name: typeof name === 'string' ? name.trim() : existingPeriod.name,
      startDate: startDate ?? existingPeriod.startDate,
      endDate: endDate ?? existingPeriod.endDate
    };

    const validationError = validatePeriodShape(mergedPeriod);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const updates: Partial<Omit<Period, 'id'>> = {};
    if (name !== undefined) updates.name = mergedPeriod.name;
    if (startDate !== undefined) updates.startDate = mergedPeriod.startDate;
    if (endDate !== undefined) updates.endDate = mergedPeriod.endDate;

    const updatedPeriod = await dataStore.updatePeriodInGroup(groupId, periodId, updates);
    if (!updatedPeriod) {
      res.status(404).json({ error: 'Period not found' });
      return;
    }

    res.json(updatedPeriod);
  } catch (error) {
    console.error('Error updating period:', error);
    res.status(500).json({ error: 'Failed to update period' });
  }
};

// DELETE /api/groups/:groupId/periods/:periodId
export const deletePeriod = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, periodId } = req.params;
    const deleted = await dataStore.deletePeriodFromGroup(groupId, periodId);

    if (!deleted) {
      res.status(404).json({ error: 'Period not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting period:', error);
    res.status(500).json({ error: 'Failed to delete period' });
  }
};