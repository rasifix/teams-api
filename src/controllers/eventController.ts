import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { Event, Invitation } from '../types';
import { getNextSequence } from '../utils/sequence';

export const getAllEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const events = await dataStore.getAllEvents(groupId);
    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
};

export const getEventById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const event = await dataStore.getEventById(id);
    
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    
    res.json(event);
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
};

export const createEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const { name, date, maxPlayersPerTeam, teams, invitations } = req.body;
    
    // Validation
    if (!name || !date || !maxPlayersPerTeam || !teams) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    
    const newEvent: Event = {
      id: await getNextSequence('events'),
      groupId,
      name,
      date,
      maxPlayersPerTeam: Number(maxPlayersPerTeam),
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
    const { name, date, maxPlayersPerTeam, teams, invitations } = req.body;
    
    const updates: Partial<Omit<Event, 'id'>> = {};
    
    if (name !== undefined) updates.name = name;
    if (date !== undefined) updates.date = date;
    if (maxPlayersPerTeam !== undefined) updates.maxPlayersPerTeam = Number(maxPlayersPerTeam);
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
    const { id, player_id } = req.params;
    const { status } = req.body;
    
    const event = await dataStore.getEventById(id);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    
    if (!['open', 'accepted', 'declined'].includes(status)) {
      res.status(400).json({ error: 'Invalid status. Must be open, accepted, or declined' });
      return;
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
    
    const updatedEvent = await dataStore.updateEvent(id, { teams });
    res.json(updatedEvent);
  } catch (error) {
    console.error('Error updating team selection:', error);
    res.status(500).json({ error: 'Failed to update team selection' });
  }
};
