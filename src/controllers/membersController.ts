import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { GroupRole, Player, Trainer } from '../types';
import { getNextSequence } from '../utils/sequence';

const VALID_MEMBER_ROLES: GroupRole[] = ['admin', 'trainer', 'guardian', 'player'];
const REVOKEABLE_MEMBER_ROLES: GroupRole[] = ['admin', 'trainer', 'guardian'];

const normalizeRoles = (roles: unknown): GroupRole[] | null => {
  if (!Array.isArray(roles) || roles.length === 0) {
    return null;
  }

  const unique = Array.from(new Set(roles));
  if (!unique.every(role => typeof role === 'string' && VALID_MEMBER_ROLES.includes(role as GroupRole))) {
    return null;
  }

  return unique as GroupRole[];
};

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

// GET /api/groups/:groupId/members?roles=player|trainer or GET /api/groups/:groupId/members (returns all)
export const getAllMembers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const rolesFilter = req.query.roles;
    const role = typeof rolesFilter === 'string' ? rolesFilter : undefined;
    
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
      res.json(player);
      return;
    }
    
    const trainer = await dataStore.getTrainerById(id);
    if (trainer) {
      const populatedTrainer = await populateTrainerNames(trainer);
      res.json(populatedTrainer);
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
    const { roles, firstName, lastName, birthDate, level, email, preferredShirtNumber, status } = req.body;
    const normalizedRoles = normalizeRoles(roles);
    
    if (!normalizedRoles) {
      res.status(400).json({ error: 'roles must be a non-empty array containing valid roles' });
      return;
    }

    const isPlayer = normalizedRoles.includes('player');
    const isTrainerLike = normalizedRoles.some(role => role === 'admin' || role === 'trainer' || role === 'guardian');
    if (isPlayer && isTrainerLike) {
      res.status(400).json({ error: 'player role cannot be combined with admin, trainer, or guardian roles' });
      return;
    }
    
    if (isPlayer) {
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
        roles: ['player'],
        firstName,
        lastName,
        birthDate,
        level,
        preferredShirtNumber,
        status: status ?? 'active'
      };
      
      const createdPlayer = await dataStore.createPlayer(newPlayer);
      res.status(201).json(createdPlayer);
    } else {
      if (!isTrainerLike) {
        res.status(400).json({ error: 'roles must include at least one of admin, trainer, or guardian' });
        return;
      }
      
      // For trainers, firstName and lastName are optional (can be populated from User)
      const newTrainer: Trainer = {
        id: await getNextSequence('members'),
        groupId,
        roles: normalizedRoles,
        firstName,
        lastName,
        email: email ? email.toLowerCase() : undefined
      };
      
      const createdTrainer = await dataStore.createTrainer(newTrainer);
      res.status(201).json(createdTrainer);
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
    const { roles, firstName, lastName, birthDate, level, email, preferredShirtNumber, status } = req.body;
    const normalizedRoles = normalizeRoles(roles);
    
    if (!normalizedRoles) {
      res.status(400).json({ error: 'roles must be a non-empty array containing valid roles' });
      return;
    }

    const isPlayer = normalizedRoles.includes('player');
    const isTrainerLike = normalizedRoles.some(role => role === 'admin' || role === 'trainer' || role === 'guardian');
    if (isPlayer && isTrainerLike) {
      res.status(400).json({ error: 'player role cannot be combined with admin, trainer, or guardian roles' });
      return;
    }
    
    if (isPlayer) {
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
        roles: ['player'],
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
      
      res.json(updatedPlayer);
    } else {
      if (!isTrainerLike) {
        res.status(400).json({ error: 'roles must include at least one of admin, trainer, or guardian' });
        return;
      }

      // For trainers, firstName and lastName are optional
      const updatedTrainer = await dataStore.updateTrainer(id, {
        roles: normalizedRoles,
        firstName,
        lastName,
        email: email ? email.toLowerCase() : undefined
      });
      
      if (!updatedTrainer) {
        res.status(404).json({ error: 'Trainer not found' });
        return;
      }
      
      res.json(updatedTrainer);
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
    const { guardianId } = req.body as { guardianId?: unknown };

    if (typeof guardianId !== 'string' || guardianId.trim() === '') {
      res.status(400).json({ error: 'guardianId is required' });
      return;
    }

    const player = await dataStore.getPlayerById(id);
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    let guardianMember = await dataStore.getTrainerById(guardianId);
    if (!guardianMember || guardianMember.groupId !== player.groupId) {
      res.status(404).json({ error: 'Guardian member not found' });
      return;
    }

    if (!guardianMember.roles.includes('guardian')) {
      const updatedRoles: GroupRole[] = Array.from(new Set<GroupRole>([...guardianMember.roles, 'guardian']));
      const updatedGuardianMember = await dataStore.updateTrainer(guardianId, { roles: updatedRoles });

      if (!updatedGuardianMember) {
        res.status(500).json({ error: 'Failed to update referenced member roles' });
        return;
      }

      guardianMember = updatedGuardianMember;
    }

    const currentGuardians = player.guardians ?? [];
    if (currentGuardians.some(existingGuardian => existingGuardian.id === guardianId)) {
      res.status(409).json({ error: 'Guardian already exists' });
      return;
    }

    await dataStore.addGuardianLink(player.groupId, guardianId, id);

    const updatedPlayer = await dataStore.getPlayerById(id);

    if (!updatedPlayer) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json(updatedPlayer);
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
    const guardianExists = currentGuardians.some(guardian => guardian.id === guardianId);
    if (!guardianExists) {
      res.status(404).json({ error: 'Guardian not found' });
      return;
    }

    const removed = await dataStore.removeGuardianLink(player.groupId, guardianId, id);
    if (!removed) {
      res.status(404).json({ error: 'Guardian not found' });
      return;
    }

    const updatedPlayer = await dataStore.getPlayerById(id);
    if (!updatedPlayer) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json(updatedPlayer);
  } catch (error) {
    console.error('Error deleting guardian:', error);
    res.status(500).json({ error: 'Failed to delete guardian' });
  }
};

// DELETE /api/groups/:groupId/members/:id/roles/:role
export const revokeRoleFromMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, id, role } = req.params;

    if (!REVOKEABLE_MEMBER_ROLES.includes(role as GroupRole)) {
      res.status(400).json({ error: 'role must be one of admin, trainer, or guardian' });
      return;
    }

    const trainer = await dataStore.getTrainerById(id);
    if (!trainer || trainer.groupId !== groupId) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const revokeResult = await dataStore.revokeRoleFromTrainer(id, role as GroupRole);
    if (revokeResult.reason === 'guardian-derived') {
      res.status(409).json({ error: 'guardian role cannot be revoked because it is derived from guardian relations' });
      return;
    }

    if (revokeResult.reason === 'last-admin') {
      res.status(409).json({ error: 'admin role can only be revoked when at least one other admin exists' });
      return;
    }

    if (revokeResult.reason === 'last-role') {
      res.status(409).json({ error: 'member must have at least one remaining role' });
      return;
    }

    if (revokeResult.reason === 'role-not-assigned') {
      res.status(409).json({ error: 'member does not currently have the specified role' });
      return;
    }

    if (revokeResult.reason === 'not-found' || !revokeResult.updatedTrainer) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    res.json(revokeResult.updatedTrainer);
  } catch (error) {
    console.error('Error revoking member role:', error);
    res.status(500).json({ error: 'Failed to revoke member role' });
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