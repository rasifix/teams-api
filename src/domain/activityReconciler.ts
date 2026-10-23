import { activityEventStore, type ActivityEventStore, type ActivityEventStream } from '../data/activityEventStore';
import {
  activityProjectionStore,
  type ActivityProjectionStore,
  type ActivityProjectionMetadata
} from '../data/activityProjectionStore';
import { replayActivityEvents } from './activityAggregate';
import { compareActivities } from './activityComparison';
import type { Activity } from '../types';
import { eventDocumentToActivity } from '../types/mappers';
import { recordActivityEventSourcingMetric } from './activityEventSourcingMetrics';
import { activitySnapshotStore, type ActivitySnapshotStore, ACTIVITY_SNAPSHOT_INTERVAL } from '../data/activitySnapshotStore';

export interface ActivityReconcileResult {
  activity?: Activity;
  deleted: boolean;
  hadEvents: boolean;
  repaired: boolean;
  revision: number;
  differences: ReturnType<typeof compareActivities>['differences'];
}

export interface ActivityReconcileReport {
  scanned: number;
  repaired: number;
  deleted: number;
  withoutEvents: number;
  failed: Array<{ squadId: string; activityId: string; error: string }>;
}

export interface ActivityReconcilerDependencies {
  eventStore?: ActivityEventStore;
  projectionStore?: ActivityProjectionStore;
  snapshotStore?: ActivitySnapshotStore;
}

/**
 * Ensures one legacy Activity projection is consistent with its event stream.
 * A missing or stale projection is rebuilt with the conditional projection
 * writer, so an older repair cannot overwrite a newer projection.
 */
export class ActivityReconciler {
  private readonly eventStore: ActivityEventStore;
  private readonly projectionStore: ActivityProjectionStore;
  private readonly snapshotStore: ActivitySnapshotStore;

  constructor(dependencies: ActivityReconcilerDependencies = {}) {
    this.eventStore = dependencies.eventStore ?? activityEventStore;
    this.projectionStore = dependencies.projectionStore ?? activityProjectionStore;
    this.snapshotStore = dependencies.snapshotStore ?? activitySnapshotStore;
  }

  async reconcile(stream: ActivityEventStream): Promise<ActivityReconcileResult> {
    const projection = await this.projectionStore.get(stream.squadId, stream.activityId);
    const snapshot = await this.snapshotStore.getLatest(stream);
    const commits = snapshot
      ? await this.eventStore.getStreamAfterRevision(stream, snapshot.revision)
      : await this.eventStore.getStream(stream);
    if (commits.length === 0 && !snapshot) {
      return {
        activity: projection && !projection.deletedAt ? eventDocumentToActivity(projection) : undefined,
        deleted: Boolean(projection?.deletedAt),
        hadEvents: false,
        repaired: false,
        revision: projection?.projectedRevision ?? 0,
        differences: []
      };
    }

    let replayed;
    try {
      replayed = replayActivityEvents(commits, snapshot ?? undefined);
    } catch (error) {
      recordActivityEventSourcingMetric('replayFailures');
      throw error;
    }
    const latestCommit = commits[commits.length - 1];
    const latestCommitId = latestCommit?._id ?? snapshot?.commitId;
    if (!latestCommitId) throw new Error(`Activity stream has no commit at revision ${replayed.revision}`);
    const metadata: ActivityProjectionMetadata = {
      projectedRevision: replayed.revision,
      projectedCommitId: latestCommitId,
      projectionSchemaVersion: 1,
      deletedAt: replayed.deleted ? new Date() : null
    };

    if (!replayed.activity) {
      const marked = projection
        ? await this.projectionStore.markProjected(stream.squadId, stream.activityId, metadata)
        : { applied: false, document: null };
      return {
        deleted: true,
        hadEvents: true,
        repaired: marked.applied,
        revision: replayed.revision,
        differences: []
      };
    }

    if (replayed.revision - (snapshot?.revision ?? 0) >= ACTIVITY_SNAPSHOT_INTERVAL) {
      await this.snapshotStore.save({
        streamId: `activity:squad-${stream.squadId}:activity-${stream.activityId}`,
        aggregateId: stream.activityId,
        squadId: stream.squadId,
        revision: replayed.revision,
        commitId: latestCommitId,
        schemaVersion: 1,
        deleted: replayed.deleted,
        activity: replayed.activity
      });
    }

    const comparison = projection
      ? compareActivities(replayed.activity, eventDocumentToActivity(projection))
      : null;
    const requiresRepair = !projection
      || Boolean(projection.deletedAt)
      || projection.projectedRevision !== replayed.revision
      || projection.projectedCommitId !== latestCommitId
      || !comparison?.equal;

    if (!requiresRepair) {
      return {
        activity: eventDocumentToActivity(projection),
        deleted: false,
        hadEvents: true,
        repaired: false,
        revision: replayed.revision,
        differences: []
      };
    }

    const applied = await this.projectionStore.apply(replayed.activity, metadata);
    if (applied.applied) recordActivityEventSourcingMetric('projectionRepairs');
    return {
      activity: eventDocumentToActivity(applied.document),
      deleted: false,
      hadEvents: true,
      repaired: applied.applied,
      revision: replayed.revision,
      differences: comparison?.differences ?? []
    };
  }

  async reconcileSquad(squadId: string): Promise<ActivityReconcileReport> {
    const projections = await this.projectionStore.list(squadId);
    const eventStreams = await this.eventStore.listStreams(squadId);
    const activityIds = new Set([
      ...projections.map(projection => projection._id),
      ...eventStreams.map(stream => stream.activityId)
    ]);
    const report: ActivityReconcileReport = {
      scanned: 0,
      repaired: 0,
      deleted: 0,
      withoutEvents: 0,
      failed: []
    };

    for (const activityId of activityIds) {
      report.scanned += 1;
      try {
        const result = await this.reconcile({ squadId, activityId });
        if (result.repaired) report.repaired += 1;
        if (result.deleted) report.deleted += 1;
        if (!result.hadEvents) report.withoutEvents += 1;
      } catch (error) {
        recordActivityEventSourcingMetric('reconciliationFailures');
        report.failed.push({
          squadId,
          activityId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return report;
  }

  async listSquadIds(): Promise<string[]> {
    const [projectionSquads, eventSquads] = await Promise.all([
      this.projectionStore.listSquadIds(),
      this.eventStore.listSquadIds()
    ]);
    return [...new Set([...projectionSquads, ...eventSquads])].sort();
  }
}

export const activityReconciler = new ActivityReconciler();
