/**
 * Event-sourcing types for the Activity aggregate.
 *
 * These types describe the append-only event envelope only. They do not
 * change the current Activity write path or the historical MongoDB
 * projection document.
 */

export const ACTIVITY_AGGREGATE_TYPE = 'activity' as const;

export type ActivityAggregateType = typeof ACTIVITY_AGGREGATE_TYPE;

export type ActivityEventType =
  | 'ActivityCreated'
  | 'ActivityImported'
  | 'ActivityDetailsChanged'
  | 'ActivityDeleted'
  | 'InvitationAdded'
  | 'InvitationRemoved'
  | 'InvitationResponseChanged'
  | 'TeamAdded'
  | 'TeamChanged'
  | 'TeamRemoved'
  | 'PlayerSelected'
  | 'PlayerUnselected'
  | 'LineupChanged'
  | 'SelectionPublished'
  | 'AttendanceRecorded'
  | 'AttendanceRemoved'
  | 'TaskCreated'
  | 'TaskChanged'
  | 'TaskDeleted'
  | 'TaskSignupAdded'
  | 'TaskSignupRemoved'
  | 'TrainingPlanChanged';

export interface ActivityEventActor {
  type: 'user' | 'system';
  userId?: string;
  memberId?: string;
  displayName?: string;
  roles?: string[];
}

export interface ActivityEventCommand {
  type: string;
  idempotencyKey: string | null;
  requestHash: string;
}

export interface ActivityStreamIdentity {
  aggregateType: ActivityAggregateType;
  squadId: string;
  activityId: string;
  streamId: string;
}

export interface DomainEvent<TType extends ActivityEventType = ActivityEventType, TData = unknown> {
  ordinal: number;
  type: TType;
  schemaVersion: number;
  data: TData;
}

export interface ActivityEvent<TEvents extends DomainEvent[] = DomainEvent[]> {
  _id: string;
  streamId: string;
  aggregateType: ActivityAggregateType;
  aggregateId: string;
  squadId: string;
  revision: number;
  command: ActivityEventCommand;
  actor: ActivityEventActor;
  recordedAt: string;
  correlationId: string;
  events: TEvents;
}
