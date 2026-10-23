export interface ActivityEventSourcingMetrics {
  commandsAppended: number;
  commandConflicts: number;
  projectionRepairs: number;
  replayFailures: number;
}

const metrics: ActivityEventSourcingMetrics = {
  commandsAppended: 0,
  commandConflicts: 0,
  projectionRepairs: 0,
  replayFailures: 0
};

export const recordActivityEventSourcingMetric = (
  metric: keyof ActivityEventSourcingMetrics
): void => {
  metrics[metric] += 1;
};

export const getActivityEventSourcingMetrics = (): ActivityEventSourcingMetrics => ({ ...metrics });
