import { MongoServerError } from 'mongodb';
import type { Collection } from 'mongodb';
import { mongoConnection } from '../database/connection';
import type { Activity } from '../types';
import { activityToEventDocument, eventDocumentToActivity } from '../types/mappers';
import type { EventDocument } from '../types/mongodb';

export interface ActivityProjectionMetadata {
  projectedRevision: number;
  projectedCommitId: string;
  projectionSchemaVersion?: number;
  deletedAt?: Date | null;
}

export interface ActivityProjectionWriteResult {
  applied: boolean;
  document: EventDocument;
}

/**
 * Conditional writer for the existing Activity projection.
 *
 * Projection updates are accepted only when they advance the revision, or
 * when they repeat the same commit. This protects the projection from an
 * older replay overwriting a newer one.
 */
export class ActivityProjectionStore {
  constructor(private readonly collection?: Collection<EventDocument>) {}

  private getCollection(): Collection<EventDocument> {
    return this.collection ?? mongoConnection.getEventsCollection();
  }

  async apply(
    activity: Activity,
    metadata: ActivityProjectionMetadata
  ): Promise<ActivityProjectionWriteResult> {
    const collection = this.getCollection();
    const existing = await collection.findOne({ _id: activity.id, groupId: activity.squadId });

    if (existing) {
      if ((existing.projectedRevision ?? 0) > metadata.projectedRevision) {
        return { applied: false, document: existing };
      }

      if (
        existing.projectedRevision === metadata.projectedRevision &&
        existing.projectedCommitId === metadata.projectedCommitId
      ) {
        return { applied: true, document: existing };
      }

      const updated = await this.updateIfNewer(activity, metadata);
      if (updated) {
        return { applied: true, document: updated };
      }

      const current = await collection.findOne({ _id: activity.id, groupId: activity.squadId });
      if (!current) {
        throw new Error(`Activity projection disappeared during update: ${activity.id}`);
      }
      return { applied: false, document: current };
    }

    try {
      const document = this.activityToProjectionDocument(activity, metadata);
      await collection.insertOne(document);
      return { applied: true, document };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        return this.apply(activity, metadata);
      }
      throw error;
    }
  }

  toActivity(result: ActivityProjectionWriteResult): Activity {
    return eventDocumentToActivity(result.document);
  }

  private async updateIfNewer(
    activity: Activity,
    metadata: ActivityProjectionMetadata
  ): Promise<EventDocument | null> {
    const document = this.activityToProjectionDocument(activity, metadata);
    const { _id, createdAt, updatedAt, ...fields } = document;
    const setFields: Record<string, unknown> = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined)
    );
    const unsetFields: Record<string, ''> = Object.fromEntries(
      Object.entries(fields)
        .filter(([, value]) => value === undefined)
        .map(([key]) => [key, ''])
    );
    setFields.updatedAt = updatedAt;

    return this.getCollection().findOneAndUpdate(
      {
        _id,
        groupId: activity.squadId,
        $or: [
          { projectedRevision: { $exists: false } },
          { projectedRevision: { $lt: metadata.projectedRevision } }
        ]
      },
      {
        $set: setFields,
        ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {})
      },
      { returnDocument: 'after' }
    );
  }

  private activityToProjectionDocument(
    activity: Activity,
    metadata: ActivityProjectionMetadata
  ): EventDocument {
    const now = new Date();
    return {
      _id: activity.id,
      ...activityToEventDocument(activity),
      createdAt: now,
      updatedAt: now,
      projectedRevision: metadata.projectedRevision,
      projectedCommitId: metadata.projectedCommitId,
      projectionSchemaVersion: metadata.projectionSchemaVersion ?? 1,
      projectionUpdatedAt: now,
      deletedAt: metadata.deletedAt ?? null
    };
  }
}

export const activityProjectionStore = new ActivityProjectionStore();
