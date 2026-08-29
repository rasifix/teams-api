import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { Event, Invitation, Team, TeamSelectionStatus } from '../types';
import { getNextSequence } from '../utils/sequence';
import { GroupAuthRequest } from '../middleware/groupAuth';

const isGuardianOnlyAccess = (roles: string[]): boolean => {
  const isPrivileged = roles.includes('admin') || roles.includes('trainer');
  return roles.includes('guardian') && !isPrivileged;
};

const filterEventForGuardian = (event: Event, childIds: Set<string>): Event => {
  const filteredInvitations = event.invitations.filter(invitation => childIds.has(invitation.playerId));
  const filteredTeams = event.teams
    .filter(team => team.selectedPlayers.some(playerId => childIds.has(playerId)))
    .map(team => ({
      ...team,
      selectedPlayers: team.selectedPlayers.filter(playerId => childIds.has(playerId)),
      shirtSetId: undefined,
      shirtAssignments: undefined
    }));

  return {
    ...event,
    invitations: filteredInvitations,
    teams: filteredTeams
  };
};

export const getAllEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const events = await dataStore.getAllEvents(groupId);
    const authReq = req as GroupAuthRequest;
    const groupAccess = authReq.groupAccess;

    if (!groupAccess || !isGuardianOnlyAccess(groupAccess.roles)) {
      res.json(events);
      return;
    }

    const childIds = await dataStore.getGuardianChildPlayerIds(groupId, groupAccess.memberId);
    const childIdSet = new Set(childIds);
    const visibleEvents = events
      .filter(event =>
        event.invitations.some(invitation => childIdSet.has(invitation.playerId)) ||
        event.teams.some(team => team.selectedPlayers.some(playerId => childIdSet.has(playerId)))
      )
      .map(event => filterEventForGuardian(event, childIdSet));

    res.json(visibleEvents);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
};

export const getEventById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, groupId } = req.params;
    const event = await dataStore.getEventById(id);
    
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    
    if (event.groupId !== groupId) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const authReq = req as GroupAuthRequest;
    const groupAccess = authReq.groupAccess;
    if (!groupAccess || !isGuardianOnlyAccess(groupAccess.roles)) {
      res.json(event);
      return;
    }

    const childIds = await dataStore.getGuardianChildPlayerIds(groupId, groupAccess.memberId);
    const childIdSet = new Set(childIds);
    const isVisible =
      event.invitations.some(invitation => childIdSet.has(invitation.playerId)) ||
      event.teams.some(team => team.selectedPlayers.some(playerId => childIdSet.has(playerId)));

    if (!isVisible) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    res.json(filterEventForGuardian(event, childIdSet));
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
};

export const createEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const { name, date, maxPlayersPerTeam, minPlayersPerTeam, location, teams, invitations } = req.body;
    
    // Validation
    if (!name || !date || !maxPlayersPerTeam || minPlayersPerTeam === undefined || !teams) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    
    const newEvent: Event = {
      id: await getNextSequence('events'),
      groupId,
      name,
      date,
      maxPlayersPerTeam: Number(maxPlayersPerTeam),
      minPlayersPerTeam: Number(minPlayersPerTeam),
      location,
      teams: teams || [],
      invitations: invitations || []
    };
    
    const createdEvent = await dataStore.createEvent(newEvent);
    res.status(201).json(createdEvent);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
};

export const updateEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, date, maxPlayersPerTeam, minPlayersPerTeam, location, playingModeId, teams, invitations } = req.body;
    
    const updates: Partial<Omit<Event, 'id'>> = {};
    
    if (name !== undefined) updates.name = name;
    if (date !== undefined) updates.date = date;
    if (maxPlayersPerTeam !== undefined) updates.maxPlayersPerTeam = Number(maxPlayersPerTeam);
    if (minPlayersPerTeam !== undefined) updates.minPlayersPerTeam = Number(minPlayersPerTeam);
    if (location !== undefined) updates.location = location;
    if (playingModeId !== undefined) updates.playingModeId = playingModeId;
    if (teams !== undefined) updates.teams = teams;
    if (invitations !== undefined) updates.invitations = invitations;
    
    const updatedEvent = await dataStore.updateEvent(id, updates);
    
    if (!updatedEvent) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    
    res.json(updatedEvent);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
};

export const deleteEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const success = await dataStore.deleteEvent(id);
    
    if (!success) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
};

// PUT /api/events/:id/players - upsert the invitations
export const upsertInvitations = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { playerIds } = req.body; // Array of player IDs
    
    const event = await dataStore.getEventById(id);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    
    if (!Array.isArray(playerIds)) {
      res.status(400).json({ error: 'playerIds must be an array' });
      return;
    }
    
    // Create invitations for new players, keep existing ones
    const existingPlayerIds = new Set(event.invitations.map(inv => inv.playerId));
    const newInvitations: Invitation[] = [];
    
    for (const playerId of playerIds) {
      if (!existingPlayerIds.has(playerId)) {
        newInvitations.push({
          id: await getNextSequence('invitations'),
          playerId,
          status: 'open'
        });
      }
    }
    
    const updatedInvitations = [...event.invitations, ...newInvitations];
    const updatedEvent = await dataStore.updateEvent(id, { invitations: updatedInvitations });
    
    res.json(updatedEvent);
  } catch (error) {
    console.error('Error upserting invitations:', error);
    res.status(500).json({ error: 'Failed to upsert invitations' });
  }
};

// PUT /api/events/:id/players/:player_id/status - update the invitation status
export const updateInvitationStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, player_id, groupId } = req.params;
    const { status } = req.body;
    const validStatuses = ['open', 'accepted', 'declined', 'injured', 'sick', 'unavailable'];
    
    const event = await dataStore.getEventById(id);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status. Must be open, accepted, declined, injured, sick, or unavailable' });
      return;
    }

    if (event.groupId !== groupId) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const authReq = req as GroupAuthRequest;
    const groupAccess = authReq.groupAccess;
    if (groupAccess && isGuardianOnlyAccess(groupAccess.roles)) {
      const childIds = await dataStore.getGuardianChildPlayerIds(groupId, groupAccess.memberId);
      if (!childIds.includes(player_id)) {
        res.status(403).json({ error: 'Guardians can only update invitations for their children' });
        return;
      }

      if (!['accepted', 'declined'].includes(status)) {
        res.status(403).json({ error: 'Guardians can only set invitation status to accepted or declined' });
        return;
      }
    }
    
    const invitationIndex = event.invitations.findIndex(inv => inv.playerId === player_id);
    if (invitationIndex === -1) {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }
    
    const updatedInvitations = [...event.invitations];
    updatedInvitations[invitationIndex] = {
      ...updatedInvitations[invitationIndex],
      status
    };
    
    const updatedEvent = await dataStore.updateEvent(id, { invitations: updatedInvitations });
    res.json(updatedEvent);
  } catch (error) {
    console.error('Error updating invitation status:', error);
    res.status(500).json({ error: 'Failed to update invitation status' });
  }
};

// PUT /api/events/:id/selection - upsert the player selection of the event
export const upsertSelection = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { teams } = req.body; // Array of teams with selectedPlayers
    
    const event = await dataStore.getEventById(id);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    
    if (!Array.isArray(teams)) {
      res.status(400).json({ error: 'teams must be an array' });
      return;
    }

    // Preserve existing team status: if incoming team omits status, carry forward
    // the stored status for matching team ids; default to 'new' for new teams.
    const existingStatusById = new Map<string, TeamSelectionStatus>(
      event.teams.map(t => [t.id, t.status ?? 'new'])
    );
    const teamsWithStatus: Team[] = teams.map((t: Team) => ({
      ...t,
      status: t.status ?? existingStatusById.get(t.id) ?? 'new'
    }));
    
    const updatedEvent = await dataStore.updateEvent(id, { teams: teamsWithStatus });
    res.json(updatedEvent);
  } catch (error) {
    console.error('Error updating team selection:', error);
    res.status(500).json({ error: 'Failed to update team selection' });
  }
};

// PUT /api/events/:id/teams/:teamId/status - update the selection status of a single team
export const updateTeamStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, teamId } = req.params;
    const { status } = req.body;

    const validStatuses: TeamSelectionStatus[] = ['new', 'selected'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const event = await dataStore.getEventById(id);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const teamIndex = event.teams.findIndex(t => t.id === teamId);
    if (teamIndex === -1) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const team = event.teams[teamIndex];

    // Idempotency: already in the requested status
    if (team.status === status) {
      res.json(event);
      return;
    }

    // Transition to 'selected' requires the team to meet the minimum player count
    if (status === 'selected') {
      const playerCount = team.selectedPlayers.length;
      if (playerCount < event.minPlayersPerTeam) {
        res.status(400).json({
          error: 'Not enough players selected',
          message: `Team "${team.name}" has ${playerCount} player(s) but requires at least ${event.minPlayersPerTeam} (event minPlayersPerTeam).`,
          teamId,
          selectedCount: playerCount,
          requiredMin: event.minPlayersPerTeam
        });
        return;
      }
    }

    const updatedTeams = [...event.teams];
    updatedTeams[teamIndex] = { ...team, status };

    const updatedEvent = await dataStore.updateEvent(id, { teams: updatedTeams });
    res.json(updatedEvent);
  } catch (error) {
    console.error('Error updating team status:', error);
    res.status(500).json({ error: 'Failed to update team status' });
  }
};
