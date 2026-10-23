import assert from 'node:assert/strict';
import {
  recordActivityEventSourcingMetric,
  renderActivityEventSourcingMetrics
} from '../src/domain/activityEventSourcingMetrics';

const before = renderActivityEventSourcingMetrics(false);
recordActivityEventSourcingMetric('commandsAppended');
recordActivityEventSourcingMetric('reconciliationFailures');
const rendered = renderActivityEventSourcingMetrics(true);

assert.match(rendered, /activity_event_sourcing_enabled 1/);
assert.match(rendered, /activity_event_sourcing_commands_appended_total 1/);
assert.match(rendered, /activity_event_sourcing_reconciliation_failures_total 1/);
assert.match(before, /activity_event_sourcing_enabled 0/);
assert.match(rendered, /# TYPE activity_event_sourcing_commands_appended_total counter/);
console.log('Activity metrics tests passed');
