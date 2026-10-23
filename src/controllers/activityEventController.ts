import type { Request, Response } from 'express';
import { activityEventStore } from '../data/activityEventStore';
import type { ActivityEventType } from '../types/activityEvents';

const activityEventTypes: ActivityEventType[] = [
  'ActivityCreated', 'ActivityImported', 'ActivityDetailsChanged', 'ActivityDeleted',
  'InvitationAdded', 'InvitationRemoved', 'InvitationResponseChanged',
  'TeamAdded', 'TeamChanged', 'TeamRemoved', 'PlayerSelected', 'PlayerUnselected',
  'LineupChanged', 'SelectionPublished', 'AttendanceRecorded', 'AttendanceRemoved',
  'TaskCreated', 'TaskChanged', 'TaskDeleted', 'TaskSignupAdded', 'TaskSignupRemoved',
  'TrainingPlanChanged'
];

export const getActivityAuditEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : undefined;
    if (eventType && !activityEventTypes.includes(eventType as ActivityEventType)) {
      res.status(400).json({ error: 'Unknown Activity event type' });
      return;
    }
    const limitValue = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    if (limitValue !== undefined && (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100)) {
      res.status(400).json({ error: 'limit must be an integer between 1 and 100' });
      return;
    }

    const page = await activityEventStore.getSquadAuditEvents(req.params.groupId, {
      activityId: typeof req.query.activityId === 'string' ? req.query.activityId : undefined,
      eventType: eventType as ActivityEventType | undefined,
      limit: limitValue,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    });
    res.json(page);
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid audit-events cursor') {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Error fetching Activity audit events:', error);
    res.status(500).json({ error: 'Failed to fetch Activity audit events' });
  }
};
