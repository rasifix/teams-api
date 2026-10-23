import { MongoServerError } from 'mongodb';
import type { Collection } from 'mongodb';
import { mongoConnection } from '../database/connection';
import type { Activity } from '../types';
import type { ActivitySnapshotDocument } from '../types/mongodb';
import type { ActivityEventStream } from './activityEventStore';

export const ACTIVITY_SNAPSHOT_INTERVAL = 100;

export interface ActivitySnapshot {
  streamId: string;
  aggregateId: string;
  squadId: string;
  revision: number;
  commitId: string;
  schemaVersion: number;
  deleted: boolean;
  activity: Activity | null;
}

export class ActivitySnapshotStore {
  constructor(private readonly collection?: Collection<ActivitySnapshotDocument>) {}

  private getCollection(): Collection<ActivitySnapshotDocument> {
    return this.collection ?? mongoConnection.getActivitySnapshotsCollection();
  }

  async getLatest(stream: ActivityEventStream): Promise<ActivitySnapshot | null> {
    const document = await this.getCollection().findOne({
      squadId: stream.squadId,
      aggregateId: stream.activityId
    });
    return document ? toSnapshot(document) : null;
  }

  async save(snapshot: ActivitySnapshot): Promise<boolean> {
    const now = new Date();
    const document: ActivitySnapshotDocument = {
      _id: `activity-snapshot-${snapshot.squadId}-${snapshot.aggregateId}`,
      ...snapshot,
      createdAt: now,
      updatedAt: now
    };
    const existing = await this.getCollection().findOne({ streamId: snapshot.streamId });
    if (existing && existing.revision >= snapshot.revision) return false;
    try {
      if (!existing) {
        await this.getCollection().insertOne(document);
      } else {
        await this.getCollection().replaceOne(
          { streamId: snapshot.streamId, revision: { $lt: snapshot.revision } },
          document
        );
      }
      return true;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return false;
      throw error;
    }
  }
}

function toSnapshot(document: ActivitySnapshotDocument): ActivitySnapshot {
  return {
    streamId: document.streamId,
    aggregateId: document.aggregateId,
    squadId: document.squadId,
    revision: document.revision,
    commitId: document.commitId,
    schemaVersion: document.schemaVersion,
    deleted: document.deleted,
    activity: document.activity
  };
}

export const activitySnapshotStore = new ActivitySnapshotStore();
