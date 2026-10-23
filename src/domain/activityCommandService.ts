import { createHash, randomUUID } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { decideActivityCommand, type ActivityCommand } from './activityCommands';
import { replayActivityEvents } from './activityAggregate';
import { activityEventStore, type ActivityEventStore } from '../data/activityEventStore';
import { activityProjectionStore, type ActivityProjectionStore } from '../data/activityProjectionStore';
import { activitySnapshotStore, type ActivitySnapshotStore, ACTIVITY_SNAPSHOT_INTERVAL } from '../data/activitySnapshotStore';
import type { Activity, GroupRole } from '../types';
import type { ActivityEventActor } from '../types/activityEvents';
import { recordActivityEventSourcingMetric } from './activityEventSourcingMetrics';

export interface ActivityWriteContext {
  actor?: ActivityEventActor;
  correlationId?: string;
  idempotencyKey?: string | null;
  commandId?: string;
  expectedRevision?: number;
}

export class ActivityRevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(`Activity revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'ActivityRevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class ActivityIdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency key was already used for a different Activity command: ${idempotencyKey}`);
    this.name = 'ActivityIdempotencyConflictError';
  }
}

export class ActivityPreconditionError extends Error {
  constructor(value: string) {
    super(`Invalid If-Match value: ${value}`);
    this.name = 'ActivityPreconditionError';
  }
}

export interface ActivityCommandServiceDependencies {
  eventStore?: ActivityEventStore;
  projectionStore?: ActivityProjectionStore;
  snapshotStore?: ActivitySnapshotStore;
}

export const isActivityEventSourcingEnabled = (): boolean =>
  process.env.ACTIVITY_EVENT_SOURCING_ENABLED === 'true';

export async function executeActivityCommand(
  current: Activity | null,
  command: ActivityCommand,
  context: ActivityWriteContext = {},
  dependencies: ActivityCommandServiceDependencies = {}
): Promise<Activity | null> {
  const eventStore = dependencies.eventStore ?? activityEventStore;
  const projectionStore = dependencies.projectionStore ?? activityProjectionStore;
  const snapshotStore = dependencies.snapshotStore ?? activitySnapshotStore;
  const requestHash = createHash('sha256').update(JSON.stringify(hashableCommand(command))).digest('hex');
  if (context.idempotencyKey && typeof eventStore.getByIdempotencyKey === 'function') {
    const previous = await eventStore.getByIdempotencyKey(activityIdentity(current, command), context.idempotencyKey);
    if (previous) {
      if (previous.command.requestHash !== requestHash) {
        recordActivityEventSourcingMetric('commandConflicts');
        throw new ActivityIdempotencyConflictError(context.idempotencyKey);
      }
      const replayedPrevious = replayActivityEvents(await eventStore.getStream({
        squadId: previous.squadId,
        activityId: previous.aggregateId
      }));
      return replayedPrevious.activity;
    }
  }

  const activityForRevision = 'activity' in command ? command.activity : current;
  if (!activityForRevision) {
    throw new Error(`${command.type} did not provide an Activity state`);
  }
  const actualRevision = await eventStore.getLatestRevision({
    squadId: activityForRevision.squadId,
    activityId: activityForRevision.id
  });
  if (context.expectedRevision !== undefined && context.expectedRevision !== actualRevision) {
    throw new ActivityRevisionConflictError(context.expectedRevision, actualRevision);
  }

  const events = decideActivityCommand(current, command);
  if (events.length === 0) return current;

  const activity = activityForRevision;
  if (!activity) {
    throw new Error(`${command.type} did not provide an Activity state`);
  }

  const revision = await eventStore.getLatestRevision({
    squadId: activity.squadId,
    activityId: activity.id
  }) + 1;
  let commit;
  try {
    commit = await eventStore.append({
      _id: randomUUID(),
      streamId: `activity:squad-${activity.squadId}:activity-${activity.id}`,
      aggregateType: 'activity',
      aggregateId: activity.id,
      squadId: activity.squadId,
      revision,
      command: {
        type: command.type,
        id: context.commandId ?? randomUUID(),
        idempotencyKey: context.idempotencyKey ?? null,
        requestHash
      },
      actor: context.actor ?? { type: 'system' },
      correlationId: context.correlationId ?? randomUUID(),
      events
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const actualRevisionAfterRace = await eventStore.getLatestRevision({
        squadId: activity.squadId,
        activityId: activity.id
      });
      recordActivityEventSourcingMetric('commandConflicts');
      throw new ActivityRevisionConflictError(revision - 1, actualRevisionAfterRace);
    }
    throw error;
  }
  recordActivityEventSourcingMetric('commandsAppended');

  const replayed = replayActivityEvents(await eventStore.getStream({
    squadId: activity.squadId,
    activityId: activity.id
  }));
  if (replayed.revision !== commit.revision) {
    throw new Error(`Activity event stream did not reach committed revision ${commit.revision}`);
  }

  if (replayed.activity) {
    await projectionStore.apply(replayed.activity, {
      projectedRevision: replayed.revision,
      projectedCommitId: commit._id,
      deletedAt: null
    });
    await maybeSaveSnapshot(snapshotStore, activity, replayed, commit._id);
    return replayed.activity;
  }

  if (replayed.deleted && current) {
    await projectionStore.apply(current, {
      projectedRevision: replayed.revision,
      projectedCommitId: commit._id,
      deletedAt: new Date()
    });
    await maybeSaveSnapshot(snapshotStore, current, replayed, commit._id);
    return null;
  }

  throw new Error(`Activity stream replay produced no state for ${activity.id}`);
}

async function maybeSaveSnapshot(
  snapshotStore: ActivitySnapshotStore,
  activity: Activity,
  replayed: { activity: Activity | null; deleted: boolean; revision: number },
  commitId: string
): Promise<void> {
  const streamId = `activity:squad-${activity.squadId}:activity-${activity.id}`;
  const existing = await snapshotStore.getLatest({ squadId: activity.squadId, activityId: activity.id });
  if (replayed.revision - (existing?.revision ?? 0) < ACTIVITY_SNAPSHOT_INTERVAL) return;
  await snapshotStore.save({
    streamId,
    aggregateId: activity.id,
    squadId: activity.squadId,
    revision: replayed.revision,
    commitId,
    schemaVersion: 1,
    deleted: replayed.deleted,
    activity: replayed.activity
  });
}

function activityIdentity(current: Activity | null, command: ActivityCommand): string {
  const activity = 'activity' in command ? command.activity : current;
  return activity?.squadId ?? '';
}

/** Create IDs are server-assigned and are not part of create request identity. */
function hashableCommand(command: ActivityCommand): unknown {
  if (command.type !== 'CreateActivity') return command;
  const { id: _generatedId, ...activity } = command.activity;
  return { ...command, activity };
}

export const systemActivityWriteContext: ActivityWriteContext = {
  actor: { type: 'system' }
};

export type ActivityActorRoles = GroupRole[];
