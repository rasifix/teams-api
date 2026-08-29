import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import type { Formation, FormationSlot } from '../types';
import { getNextSequence } from '../utils/sequence';

const POSITION_CODES = new Set([
  'GK',
  'LB',
  'CB',
  'RB',
  'LWB',
  'RWB',
  'CDM',
  'CM',
  'CAM',
  'LM',
  'RM',
  'LW',
  'RW',
  'CF',
  'ST'
]);

type CreateSlotInput = { positionCode?: unknown };
type UpdateSlotInput = { id?: unknown; positionCode?: unknown };
type FormationBody = { name?: unknown; slots?: unknown };

function validateSlots(
  slots: unknown,
  mode: 'create' | 'update'
): { ok: true; value: Array<CreateSlotInput | UpdateSlotInput> } | { ok: false; error: string } {
  if (!Array.isArray(slots) || slots.length < 2) {
    return { ok: false, error: 'slots must be an array with at least 2 items' };
  }

  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') {
      return { ok: false, error: 'each slot must be an object' };
    }

    const slotObj = slot as CreateSlotInput | UpdateSlotInput;
    if (typeof slotObj.positionCode !== 'string' || !POSITION_CODES.has(slotObj.positionCode)) {
      return { ok: false, error: 'each slot must include a valid positionCode' };
    }

    if (mode === 'update') {
      const updateSlot = slotObj as UpdateSlotInput;
      if (updateSlot.id !== undefined && typeof updateSlot.id !== 'string') {
        return { ok: false, error: 'slot id must be a string when provided' };
      }
    }
  }

  const gkCount = slots.filter(slot => {
    const slotObj = slot as CreateSlotInput | UpdateSlotInput;
    return slotObj.positionCode === 'GK';
  }).length;

  if (gkCount !== 1) {
    return { ok: false, error: 'exactly one slot must have positionCode GK' };
  }

  return { ok: true, value: slots as Array<CreateSlotInput | UpdateSlotInput> };
}

async function normalizeCreateSlots(slots: CreateSlotInput[]): Promise<FormationSlot[]> {
  const normalized: FormationSlot[] = [];

  for (const slot of slots) {
    normalized.push({
      id: await getNextSequence('formationslots'),
      positionCode: slot.positionCode as FormationSlot['positionCode']
    });
  }

  return normalized;
}

async function normalizeUpdateSlots(
  incomingSlots: UpdateSlotInput[],
  existingSlots: FormationSlot[]
): Promise<FormationSlot[]> {
  const normalized: FormationSlot[] = [];

  for (let index = 0; index < incomingSlots.length; index += 1) {
    const incoming = incomingSlots[index];
    normalized.push({
      id:
        typeof incoming.id === 'string' && incoming.id.trim()
          ? incoming.id
          : existingSlots[index]?.id ?? (await getNextSequence('formationslots')),
      positionCode: incoming.positionCode as FormationSlot['positionCode']
    });
  }

  return normalized;
}

// GET /api/groups/:groupId/formations
export const getFormations = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const formations = await dataStore.getGroupFormations(groupId);

    if (formations === null) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    res.json(formations);
  } catch (error) {
    console.error('Error fetching formations:', error);
    res.status(500).json({ error: 'Failed to fetch formations' });
  }
};

// POST /api/groups/:groupId/formations
export const createFormation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const { name, slots } = req.body as FormationBody;

    const normalizedName = typeof name === 'string' ? name.trim() : '';
    if (!normalizedName) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const slotValidation = validateSlots(slots, 'create');
    if (!slotValidation.ok) {
      res.status(400).json({ error: slotValidation.error });
      return;
    }

    const normalizedSlots = await normalizeCreateSlots(slotValidation.value as CreateSlotInput[]);
    const newFormation: Formation = {
      id: await getNextSequence('formations'),
      name: normalizedName,
      slots: normalizedSlots
    };

    const created = await dataStore.addFormationToGroup(groupId, newFormation);
    if (!created) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating formation:', error);
    res.status(500).json({ error: 'Failed to create formation' });
  }
};

// PUT /api/groups/:groupId/formations/:formationId
export const updateFormation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, formationId } = req.params;
    const { name, slots } = req.body as FormationBody;

    const formations = await dataStore.getGroupFormations(groupId);
    if (formations === null) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const existing = formations.find(formation => formation.id === formationId);
    if (!existing) {
      res.status(404).json({ error: 'Group or formation not found' });
      return;
    }

    if (name === undefined && slots === undefined) {
      res.status(400).json({ error: 'At least one of name or slots is required' });
      return;
    }

    const updates: Partial<Omit<Formation, 'id'>> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name must be a non-empty string when provided' });
        return;
      }

      updates.name = name.trim();
    }

    if (slots !== undefined) {
      const slotValidation = validateSlots(slots, 'update');
      if (!slotValidation.ok) {
        res.status(400).json({ error: slotValidation.error });
        return;
      }

      updates.slots = await normalizeUpdateSlots(slotValidation.value as UpdateSlotInput[], existing.slots);
    }

    const updated = await dataStore.updateFormationInGroup(groupId, formationId, updates);
    if (!updated) {
      res.status(404).json({ error: 'Group or formation not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating formation:', error);
    res.status(500).json({ error: 'Failed to update formation' });
  }
};

// DELETE /api/groups/:groupId/formations/:formationId
export const deleteFormation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, formationId } = req.params;
    const result = await dataStore.deleteFormationFromGroup(groupId, formationId);

    if (!result.deleted) {
      if (result.reason === 'in-use') {
        res.status(409).json({ error: 'Formation is referenced by one or more teams and cannot be deleted' });
        return;
      }

      res.status(404).json({ error: 'Group or formation not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting formation:', error);
    res.status(500).json({ error: 'Failed to delete formation' });
  }
};
