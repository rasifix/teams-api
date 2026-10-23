import { createHash } from 'node:crypto';
import type { Collection } from 'mongodb';
import { replayActivityEvents } from '../domain/activityAggregate';
import { canonicalJson, compareActivities } from '../domain/activityComparison';
import { activityEventStore, type ActivityEventStore } from '../data/activityEventStore';
import { activityProjectionStore, type ActivityProjectionStore } from '../data/activityProjectionStore';
import { mongoConnection } from '../database/connection';
import type { Activity } from '../types';
import { eventDocumentToActivity } from '../types/mappers';
import type { EventDocument } from '../types/mongodb';

export interface ActivityEventMigrationDependencies {
  projections?: Collection<EventDocument>;
  eventStore?: ActivityEventStore;
  projectionStore?: ActivityProjectionStore;
}

export interface ActivityEventMigrationResult {
  scanned: number;
  imported: number;
  alreadyMigrated: number;
  skipped: number;
  verified: number;
  mismatches: Array<{
    squadId: string;
    activityId: string;
    revision: number;
    reason: string;
    differences: ReturnType<typeof compareActivities>['differences'];
  }>;
}

/**
 * Converts the current Activity projection into deterministic baseline events.
 *
 * This function does not delete or replace projection documents. The caller is
 * responsible for pausing Activity writes before invoking it.
 */
export async function migrateActivityProjections(
  dependencies: ActivityEventMigrationDependencies = {}
): Promise<ActivityEventMigrationResult> {
  const projections = dependencies.projections ?? mongoConnection.getEventsCollection();
  const eventStore = dependencies.eventStore ?? activityEventStore;
  const projectionStore = dependencies.projectionStore ?? activityProjectionStore;
  const result: ActivityEventMigrationResult = {
    scanned: 0,
    imported: 0,
    alreadyMigrated: 0,
    skipped: 0,
    verified: 0,
    mismatches: []
  };

  const documents = await projections.find({}).toArray();
  for (const document of documents) {
    const legacyKind = (document as unknown as { kind?: string }).kind;
    if (legacyKind === 'training' || legacyKind === 'social') {
      result.skipped += 1;
      continue;
    }
    result.scanned += 1;

    const activity = eventDocumentToActivity(document);
    const stream = { squadId: activity.squadId, activityId: activity.id };
    let commits = await eventStore.getStream(stream);

    if (commits.length === 0) {
      const baseline = await eventStore.append({
        _id: baselineCommitId(activity),
        streamId: `activity:squad-${activity.squadId}:activity-${activity.id}`,
        aggregateType: 'activity',
        aggregateId: activity.id,
        squadId: activity.squadId,
        revision: 1,
        command: {
          type: 'MigrateActivityProjection',
          idempotencyKey: `activity-baseline:${activity.squadId}:${activity.id}`,
          requestHash: activityHash(activity)
        },
        actor: { type: 'system', displayName: 'activity-event-migration' },
        correlationId: `activity-baseline:${activity.squadId}:${activity.id}`,
        events: [{
          ordinal: 0,
          type: 'ActivityImported',
          schemaVersion: 1,
          data: activity
        }]
      });
      commits = [baseline];
      result.imported += 1;
    } else {
      result.alreadyMigrated += 1;
    }

    const replayed = replayActivityEvents(commits);
    const comparison = replayed.activity
      ? compareActivities(replayed.activity, activity)
      : null;
    if (!comparison || !comparison.equal) {
      const mismatch = {
        squadId: activity.squadId,
        activityId: activity.id,
        revision: replayed.revision,
        reason: comparison
          ? 'Replayed Activity differs from the existing projection'
          : 'Replay did not produce an Activity',
        differences: comparison?.differences ?? []
      };
      result.mismatches.push(mismatch);
      continue;
    }

    await projectionStore.markProjected(activity.squadId, activity.id, {
      projectedRevision: replayed.revision,
      projectedCommitId: commits[commits.length - 1]._id,
      deletedAt: null
    });
    result.verified += 1;
  }

  return result;
}

function baselineCommitId(activity: Activity): string {
  return `activity-baseline-${activityHash(activity).slice(0, 32)}`;
}

function activityHash(activity: Activity): string {
  return createHash('sha256').update(canonicalJson(activity)).digest('hex');
}
