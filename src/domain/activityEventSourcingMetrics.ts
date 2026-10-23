export interface ActivityEventSourcingMetrics {
  commandsAppended: number;
  commandConflicts: number;
  projectionRepairs: number;
  replayFailures: number;
  reconciliationFailures: number;
}

const metrics: ActivityEventSourcingMetrics = {
  commandsAppended: 0,
  commandConflicts: 0,
  projectionRepairs: 0,
  replayFailures: 0,
  reconciliationFailures: 0
};

export const recordActivityEventSourcingMetric = (
  metric: keyof ActivityEventSourcingMetrics
): void => {
  metrics[metric] += 1;
};

export const getActivityEventSourcingMetrics = (): ActivityEventSourcingMetrics => ({ ...metrics });

export const renderActivityEventSourcingMetrics = (enabled: boolean): string => {
  const current = getActivityEventSourcingMetrics();
  return [
    '# HELP activity_event_sourcing_enabled Whether Activity event sourcing is enabled in this process.',
    '# TYPE activity_event_sourcing_enabled gauge',
    `activity_event_sourcing_enabled ${enabled ? 1 : 0}`,
    '# HELP activity_event_sourcing_commands_appended_total Activity event commits appended by this process.',
    '# TYPE activity_event_sourcing_commands_appended_total counter',
    `activity_event_sourcing_commands_appended_total ${current.commandsAppended}`,
    '# HELP activity_event_sourcing_command_conflicts_total Activity command concurrency or idempotency conflicts.',
    '# TYPE activity_event_sourcing_command_conflicts_total counter',
    `activity_event_sourcing_command_conflicts_total ${current.commandConflicts}`,
    '# HELP activity_event_sourcing_projection_repairs_total Activity projections repaired by this process.',
    '# TYPE activity_event_sourcing_projection_repairs_total counter',
    `activity_event_sourcing_projection_repairs_total ${current.projectionRepairs}`,
    '# HELP activity_event_sourcing_replay_failures_total Activity event replays that failed in this process.',
    '# TYPE activity_event_sourcing_replay_failures_total counter',
    `activity_event_sourcing_replay_failures_total ${current.replayFailures}`,
    '# HELP activity_event_sourcing_reconciliation_failures_total Activity reconciliation failures recorded by this process.',
    '# TYPE activity_event_sourcing_reconciliation_failures_total counter',
    `activity_event_sourcing_reconciliation_failures_total ${current.reconciliationFailures}`,
    ''
  ].join('\n');
};
