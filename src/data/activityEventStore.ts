import type { Collection, Filter, Sort } from 'mongodb';
import { mongoConnection } from '../database/connection';
import type {
  ActivityEvent,
  ActivityEventToAppend,
  ActivityEventType,
  DomainEvent
} from '../types/activityEvents';
import type { ActivityEventDocument } from '../types/mongodb';

export interface ActivityEventStream {
  squadId: string;
  activityId: string;
}

export interface ActivityAuditQuery {
  activityId?: string;
  eventType?: ActivityEventType;
  limit?: number;
  cursor?: string;
}

export interface ActivityAuditPage {
  items: ActivityEvent[];
  nextCursor?: string;
}

/**
 * Append-only persistence boundary for Activity events.
 *
 * This repository deliberately has no update or delete operation. Projection
 * writes and aggregate logic belong to later event-sourcing tasks.
 */
export class ActivityEventStore {
  constructor(
    private readonly collection?: Collection<ActivityEventDocument>
  ) {}

  private getCollection(): Collection<ActivityEventDocument> {
    return this.collection ?? mongoConnection.getActivityEventsCollection();
  }

  async append<TEvents extends DomainEvent[]>(
    event: ActivityEventToAppend<TEvents>
  ): Promise<ActivityEvent<TEvents>> {
    const committed: ActivityEvent<TEvents> = {
      ...event,
      recordedAt: new Date().toISOString()
    };
    const document: ActivityEventDocument = {
      ...committed,
      recordedAt: new Date(committed.recordedAt)
    };

    await this.getCollection().insertOne(document);
    return committed;
  }

  async getStream(stream: ActivityEventStream): Promise<ActivityEvent[]> {
    const filter: Filter<ActivityEventDocument> = {
      squadId: stream.squadId,
      aggregateId: stream.activityId
    };
    const sort: Sort = { revision: 1 };
    const documents = await this.getCollection().find(filter).sort(sort).toArray();
    return documents.map(activityEventDocumentToDomain);
  }

  async getStreamAfterRevision(stream: ActivityEventStream, revision: number): Promise<ActivityEvent[]> {
    const filter: Filter<ActivityEventDocument> = {
      squadId: stream.squadId,
      aggregateId: stream.activityId,
      revision: { $gt: revision }
    };
    const documents = await this.getCollection().find(filter).sort({ revision: 1 }).toArray();
    return documents.map(activityEventDocumentToDomain);
  }

  async getLatestRevision(stream: ActivityEventStream): Promise<number> {
    const filter: Filter<ActivityEventDocument> = {
      squadId: stream.squadId,
      aggregateId: stream.activityId
    };
    const latest = await this.getCollection().find(filter).sort({ revision: -1 }).limit(1).next();
    return latest?.revision ?? 0;
  }

  async listStreams(squadId: string): Promise<ActivityEventStream[]> {
    const aggregateIds = await this.getCollection().distinct('aggregateId', {
      squadId,
      aggregateType: 'activity'
    });
    return aggregateIds
      .filter((aggregateId): aggregateId is string => typeof aggregateId === 'string')
      .map(activityId => ({ squadId, activityId }));
  }

  async listSquadIds(): Promise<string[]> {
    const squadIds = await this.getCollection().distinct('squadId', { aggregateType: 'activity' });
    return squadIds.filter((squadId): squadId is string => typeof squadId === 'string');
  }

  async getByIdempotencyKey(squadId: string, idempotencyKey: string): Promise<ActivityEvent | null> {
    const document = await this.getCollection().findOne({
      squadId,
      'command.idempotencyKey': idempotencyKey
    });
    return document ? activityEventDocumentToDomain(document) : null;
  }

  async getSquadAuditEvents(squadId: string, query: ActivityAuditQuery = {}): Promise<ActivityAuditPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const filters: Filter<ActivityEventDocument>[] = [{ squadId }];
    if (query.activityId) filters.push({ aggregateId: query.activityId });
    if (query.eventType) filters.push({ 'events.type': query.eventType });
    if (query.cursor) filters.push(cursorFilter(query.cursor));

    const documents = await this.getCollection()
      .find({ $and: filters })
      .sort({ recordedAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
    const pageDocuments = documents.slice(0, limit);
    const items = pageDocuments.map(activityEventDocumentToDomain);
    return {
      items,
      ...(documents.length > limit && items.length > 0
        ? { nextCursor: encodeCursor(items[items.length - 1]) }
        : {})
    };
  }
}

function cursorFilter(cursor: string): Filter<ActivityEventDocument> {
  let parsed: { recordedAt: string; id: string };
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { recordedAt: string; id: string };
  } catch {
    throw new Error('Invalid audit-events cursor');
  }
  if (!parsed || typeof parsed.recordedAt !== 'string' || typeof parsed.id !== 'string') {
    throw new Error('Invalid audit-events cursor');
  }
  const recordedAt = new Date(parsed.recordedAt);
  if (Number.isNaN(recordedAt.getTime())) throw new Error('Invalid audit-events cursor');
  return {
    $or: [
      { recordedAt: { $lt: recordedAt } },
      { recordedAt, _id: { $lt: parsed.id } }
    ]
  };
}

function encodeCursor(event: ActivityEvent): string {
  return Buffer.from(JSON.stringify({ recordedAt: event.recordedAt, id: event._id })).toString('base64url');
}

function activityEventDocumentToDomain(document: ActivityEventDocument): ActivityEvent {
  return {
    ...document,
    recordedAt: document.recordedAt.toISOString()
  };
}

export const activityEventStore = new ActivityEventStore();
