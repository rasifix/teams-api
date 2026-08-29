import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import type { PlayingMode } from '../types';
import { getNextSequence } from '../utils/sequence';

type PlayingModeBody = {
  name?: unknown;
  numberOfPeriods?: unknown;
  periodLengthMinutes?: unknown;
};

function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed >= 1 ? parsed : null;
  }

  return null;
}

function validateCreateBody(body: PlayingModeBody): { ok: true; value: Omit<PlayingMode, 'id' | 'isDefault'> } | { ok: false; error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'name is required' };
  }

  const numberOfPeriods = toPositiveInt(body.numberOfPeriods);
  if (numberOfPeriods === null) {
    return { ok: false, error: 'numberOfPeriods must be an integer greater than or equal to 1' };
  }

  const periodLengthMinutes = toPositiveInt(body.periodLengthMinutes);
  if (periodLengthMinutes === null) {
    return { ok: false, error: 'periodLengthMinutes must be an integer greater than or equal to 1' };
  }

  return {
    ok: true,
    value: {
      name,
      numberOfPeriods,
      periodLengthMinutes
    }
  };
}

function validateUpdateBody(body: PlayingModeBody): { ok: true; value: Partial<Omit<PlayingMode, 'id' | 'isDefault'>> } | { ok: false; error: string } {
  const updates: Partial<Omit<PlayingMode, 'id' | 'isDefault'>> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return { ok: false, error: 'name must be a non-empty string when provided' };
    }

    updates.name = body.name.trim();
  }

  if (body.numberOfPeriods !== undefined) {
    const parsed = toPositiveInt(body.numberOfPeriods);
    if (parsed === null) {
      return { ok: false, error: 'numberOfPeriods must be an integer greater than or equal to 1' };
    }

    updates.numberOfPeriods = parsed;
  }

  if (body.periodLengthMinutes !== undefined) {
    const parsed = toPositiveInt(body.periodLengthMinutes);
    if (parsed === null) {
      return { ok: false, error: 'periodLengthMinutes must be an integer greater than or equal to 1' };
    }

    updates.periodLengthMinutes = parsed;
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'At least one of name, numberOfPeriods, or periodLengthMinutes is required' };
  }

  return { ok: true, value: updates };
}

// GET /api/groups/:groupId/playing-modes
export const getPlayingModes = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const modes = await dataStore.getGroupPlayingModes(groupId);

    if (modes === null) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    res.json(modes);
  } catch (error) {
    console.error('Error fetching playing modes:', error);
    res.status(500).json({ error: 'Failed to fetch playing modes' });
  }
};

// POST /api/groups/:groupId/playing-modes
export const createPlayingMode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const validation = validateCreateBody(req.body as PlayingModeBody);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const newMode: PlayingMode = {
      id: await getNextSequence('playingmodes'),
      ...validation.value,
      isDefault: false
    };

    const created = await dataStore.addPlayingModeToGroup(groupId, newMode);
    if (!created) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating playing mode:', error);
    res.status(500).json({ error: 'Failed to create playing mode' });
  }
};

// PUT /api/groups/:groupId/playing-modes/:playingModeId
export const updatePlayingMode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, playingModeId } = req.params;

    const group = await dataStore.getGroupById(groupId);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const validation = validateUpdateBody(req.body as PlayingModeBody);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const updated = await dataStore.updatePlayingModeInGroup(groupId, playingModeId, validation.value);
    if (!updated) {
      res.status(404).json({ error: 'Group or playing mode not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating playing mode:', error);
    res.status(500).json({ error: 'Failed to update playing mode' });
  }
};

// DELETE /api/groups/:groupId/playing-modes/:playingModeId
export const deletePlayingMode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, playingModeId } = req.params;

    const result = await dataStore.deletePlayingModeFromGroup(groupId, playingModeId);
    if (!result.deleted) {
      if (result.reason === 'in-use') {
        res.status(409).json({ error: 'Playing mode is referenced by one or more events and cannot be deleted' });
        return;
      }

      res.status(404).json({ error: 'Group or playing mode not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting playing mode:', error);
    res.status(500).json({ error: 'Failed to delete playing mode' });
  }
};

// POST /api/groups/:groupId/playing-modes/:playingModeId/set-default
export const setDefaultPlayingMode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, playingModeId } = req.params;
    const updated = await dataStore.setDefaultPlayingModeInGroup(groupId, playingModeId);

    if (!updated) {
      res.status(404).json({ error: 'Group or playing mode not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error('Error setting default playing mode:', error);
    res.status(500).json({ error: 'Failed to set default playing mode' });
  }
};
