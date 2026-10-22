import type { Collection, Filter, Sort } from 'mongodb';
import { mongoConnection } from '../database/connection';
import type {
  ActivityEvent,
  ActivityEventToAppend,
  DomainEvent
} from '../types/activityEvents';
import type { ActivityEventDocument } from '../types/mongodb';

export interface ActivityEventStream {
  squadId: string;
  activityId: string;
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

  async getLatestRevision(stream: ActivityEventStream): Promise<number> {
    const filter: Filter<ActivityEventDocument> = {
      squadId: stream.squadId,
      aggregateId: stream.activityId
    };
    const latest = await this.getCollection().find(filter).sort({ revision: -1 }).limit(1).next();
    return latest?.revision ?? 0;
  }
}

function activityEventDocumentToDomain(document: ActivityEventDocument): ActivityEvent {
  return {
    ...document,
    recordedAt: document.recordedAt.toISOString()
  };
}

export const activityEventStore = new ActivityEventStore();
