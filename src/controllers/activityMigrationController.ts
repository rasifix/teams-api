import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { migrateActivityProjections } from '../migrations/activityEventMigration';

let migrationRunning = false;

const validToken = (provided: string | undefined, configured: string | undefined): boolean => {
  if (!provided || !configured) return false;
  const providedBytes = Buffer.from(provided);
  const configuredBytes = Buffer.from(configured);
  return providedBytes.length === configuredBytes.length
    && timingSafeEqual(providedBytes, configuredBytes);
};

export const runActivityEventMigration = async (req: Request, res: Response): Promise<void> => {
  const configuredToken = process.env.ACTIVITY_MIGRATION_TOKEN;
  if (!configuredToken) {
    res.status(503).json({ error: 'Activity migration endpoint is not configured' });
    return;
  }

  if (!validToken(req.header('X-Migration-Token'), configuredToken)) {
    res.status(401).json({ error: 'Migration authentication failed' });
    return;
  }

  if (req.header('X-Confirm-Activity-Writes-Paused') !== 'yes') {
    res.status(400).json({ error: 'X-Confirm-Activity-Writes-Paused: yes is required' });
    return;
  }

  if (migrationRunning) {
    res.status(409).json({ error: 'Activity migration is already running' });
    return;
  }

  migrationRunning = true;
  try {
    const result = await migrateActivityProjections();
    res.status(result.mismatches.length === 0 ? 200 : 409).json(result);
  } catch (error) {
    console.error('Activity event migration failed:', error);
    res.status(500).json({ error: 'Activity event migration failed' });
  } finally {
    migrationRunning = false;
  }
};
