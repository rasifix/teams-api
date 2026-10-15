import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { dataStore } from '../data/store';
import { createBirthdayCalendar } from '../utils/birthdayCalendar';

const buildSubscriptionUrl = (req: Request, token: string): string => {
  const configuredBaseUrl = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
  const baseUrl = configuredBaseUrl ?? `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/api/birthday-calendars/${token}.ics`;
};

export const getBirthdayCalendarSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = await dataStore.getBirthdayCalendarToken(req.params.id);
    res.json({ subscriptionUrl: token ? buildSubscriptionUrl(req, token) : null });
  } catch (error) {
    console.error('Error reading birthday calendar subscription:', error);
    res.status(500).json({ error: 'Failed to read birthday calendar subscription' });
  }
};

export const createBirthdayCalendarSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const existingToken = await dataStore.getBirthdayCalendarToken(req.params.id);
    const token = existingToken ?? randomBytes(32).toString('base64url');
    if (!existingToken && !(await dataStore.setBirthdayCalendarToken(req.params.id, token))) {
      res.status(404).json({ error: 'Squad not found' });
      return;
    }

    res.status(existingToken ? 200 : 201).json({ subscriptionUrl: buildSubscriptionUrl(req, token) });
  } catch (error) {
    console.error('Error creating birthday calendar subscription:', error);
    res.status(500).json({ error: 'Failed to create birthday calendar subscription' });
  }
};

export const revokeBirthdayCalendarSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await dataStore.setBirthdayCalendarToken(req.params.id, null))) {
      res.status(404).json({ error: 'Squad not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error revoking birthday calendar subscription:', error);
    res.status(500).json({ error: 'Failed to revoke birthday calendar subscription' });
  }
};

export const getBirthdayCalendarFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params.token;
    const group = await dataStore.getGroupByBirthdayCalendarToken(token);
    if (!group) {
      res.status(404).send('Calendar not found');
      return;
    }

    const players = await dataStore.getAllPlayers(group.id);
    const calendar = createBirthdayCalendar(group.name, players);
    res
      .status(200)
      .set({
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="birthdays.ics"',
        'Cache-Control': 'private, max-age=300'
      })
      .send(calendar);
  } catch (error) {
    console.error('Error generating birthday calendar:', error);
    res.status(500).send('Failed to generate calendar');
  }
};
