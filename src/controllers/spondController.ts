import { Request, Response } from 'express';
import {
  listSpondGroups,
  readSpondSnapshot,
  SpondProxyError
} from '../services/spondService';

const MAX_SYNC_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

type Credentials = { email: string; password: string };

const credentialsFrom = (value: unknown): Credentials | null => {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (typeof body.email !== 'string' || !body.email.trim() ||
      typeof body.password !== 'string' || !body.password) return null;
  return { email: body.email.trim(), password: body.password };
};

const sendError = (res: Response, error: unknown, context = 'request'): void => {
  if (error instanceof SpondProxyError) {
    console.error(`[spond] ${context} proxy error (${error.status} ${error.code}):`, error.message, error.stack);
    res.status(error.status).json({ error: error.code });
    return;
  }
  console.error(`[spond] ${context} unexpected error:`, error instanceof Error ? (error.stack ?? error.message) : error);
  res.status(502).json({ error: 'SPOND_REQUEST_FAILED' });
};

export const proxySpondGroups = async (req: Request, res: Response): Promise<void> => {
  const credentials = credentialsFrom(req.body);
  if (!credentials) {
    res.status(400).json({ error: 'SPOND_CREDENTIALS_REQUIRED' });
    return;
  }
  try {
    res.json(await listSpondGroups(credentials.email, credentials.password));
  } catch (error) {
    console.error('[spond] proxySpondGroups caught exception:', error);
    sendError(res, error, 'proxySpondGroups');
  }
};

export const proxySpondSnapshot = async (req: Request, res: Response): Promise<void> => {
  const credentials = credentialsFrom(req.body);
  const body = req.body as Record<string, unknown> | undefined;
  const groupId = typeof body?.groupId === 'string' ? body.groupId.trim() : '';
  const subGroupId = typeof body?.subGroupId === 'string' && body.subGroupId.trim() ? body.subGroupId.trim() : undefined;
  const from = typeof body?.from === 'string' ? body.from : '';
  const to = typeof body?.to === 'string' ? body.to : '';
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);

  if (!credentials) {
    res.status(400).json({ error: 'SPOND_CREDENTIALS_REQUIRED' });
    return;
  }
  if (!groupId || Number.isNaN(fromTime) || Number.isNaN(toTime) || toTime <= fromTime) {
    res.status(400).json({ error: 'SPOND_INVALID_SCOPE' });
    return;
  }
  if (toTime - fromTime > MAX_SYNC_RANGE_MS) {
    res.status(400).json({ error: 'SPOND_RANGE_TOO_LARGE' });
    return;
  }

  try {
    res.json(await readSpondSnapshot(credentials.email, credentials.password, groupId, from, to, subGroupId));
  } catch (error) {
    console.error(`[spond] proxySpondSnapshot caught exception (groupId=${groupId}, subGroupId=${subGroupId}):`, error);
    sendError(res, error, 'proxySpondSnapshot');
  }
};
