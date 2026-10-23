# Activity Event-Sourcing Production Rollout Plan

## Status

| Area | Status |
| --- | --- |
| Rollout plan | ![Ready for review](https://img.shields.io/badge/plan-ready%20for%20review-blue) |
| ES-15 snapshot review | ![Reviewed](https://img.shields.io/badge/ES--15-reviewed-brightgreen) |
| Code rollout | ![Pending](https://img.shields.io/badge/code-pending-yellow) |
| Baseline migration | ![Not started](https://img.shields.io/badge/migration-not%20started-lightgrey) |
| Backup and restore drill | ![Required](https://img.shields.io/badge/backup-required-orange) |
| Production feature flag | ![Disabled](https://img.shields.io/badge/flag-disabled-lightgrey) |
| Production rollout | ![Not started](https://img.shields.io/badge/rollout-not%20started-lightgrey) |

**Last reviewed:** 2026-10-23  
**Scope:** Activity event sourcing, baseline migration, projections, and snapshots  
**Primary safety rule:** Never allow legacy direct Activity writes and event-sourced Activity writes to operate concurrently.

## Rollout gates

Proceed only when every gate is green:

| Gate | Required result | Status |
| --- | --- | --- |
| Reviewed release | ES-15 code and tests are included in the release | ![Pending](https://img.shields.io/badge/pending-yellow) |
| Runtime | Production uses Node 22 | ![Pending](https://img.shields.io/badge/pending-yellow) |
| Backup | Backup completed and restored successfully into an isolated target | ![Required](https://img.shields.io/badge/required-orange) |
| Write pause | Activity writes and Spond Activity imports can be paused | ![Required](https://img.shields.io/badge/required-orange) |
| Migration | `mismatches` is empty and every scanned Activity is verified | ![Not started](https://img.shields.io/badge/not%20started-lightgrey) |
| Monitoring | Errors, conflicts, replay failures, repairs, latency, and MongoDB health are monitored | ![Required](https://img.shields.io/badge/required-orange) |
| Rollback | Event-aware rollback and projection rebuild procedure is tested | ![Required](https://img.shields.io/badge/required-orange) |

## 1. Preflight

Use a release containing the reviewed ES-15 implementation. Confirm that:

- CI passes under Node 22.
- MongoDB backups are current.
- A restore drill has succeeded.
- Activity writes can be paused without losing requests.
- Monitoring and alerting are active.
- The deployment can prevent old application instances from handling Activity writes after cutover.

The application initializes these resources at startup:

- `activity-events`
- `activity-snapshots`
- event-store indexes and validation
- snapshot indexes and validation

## 2. Deploy with event sourcing disabled

Set the production configuration through the deployment secret/configuration system:

```env
ACTIVITY_EVENT_SOURCING_ENABLED=false
```

Deploy the new application version and verify:

```bash
curl -fsS https://api.example.com/health | jq
```

The response must show:

```json
{
  "activityEventSourcing": {
    "enabled": false
  }
}
```

Smoke-test Activity reads and writes while the legacy path is still active.

## 3. Pause Activity writes

Temporarily block or place in maintenance mode:

- Activity create, update, and delete
- invitation responses
- team and selection changes
- attendance and task mutations
- Spond imports that create or modify Activities

Reads may remain active. The pause is required because migration reads existing projections and creates revision-1 baseline events.

## 4. Back up MongoDB

For a self-managed MongoDB deployment:

```bash
mongodump \
  --uri="$MONGODB_URL" \
  --archive=/backups/teams-pre-event-sourcing-$(date -u +%Y%m%dT%H%M%SZ).archive \
  --gzip
```

Verify that the archive can be listed and restored into an isolated database. For MongoDB Atlas, take a provider snapshot and restore it into a separate validation cluster.

Do not proceed until the restore check succeeds.

## 5. Run the baseline migration

Keep event sourcing disabled and run:

```bash
ACTIVITY_EVENT_SOURCING_ENABLED=false \
npm run migrate:activity-events
```

The migration:

- scans existing `events` projection documents;
- skips `training` and `social` records;
- creates deterministic `ActivityImported` revision-1 commits;
- leaves projection documents intact;
- marks projection metadata;
- replays each event stream;
- compares replayed state with the existing projection;
- exits unsuccessfully when mismatches are found.

Require output equivalent to:

```json
{
  "mismatches": [],
  "verified": 123,
  "scanned": 123
}
```

If `mismatches` is non-empty, stop the rollout and investigate. Do not enable event sourcing.

Useful MongoDB checks:

```javascript
db.getCollection("activity-events").countDocuments({})
db.getCollection("activity-snapshots").countDocuments({})
db.getCollection("events").countDocuments({
  kind: { $nin: ["training", "social"] }
})
db.getCollection("events").countDocuments({
  projectedRevision: { $exists: false }
})
```

The final query should return zero for migrated Activities.

## 6. Enable event-sourced writes

Change production configuration:

```env
ACTIVITY_EVENT_SOURCING_ENABLED=true
```

Deploy the event-aware version and verify:

```bash
curl -fsS https://api.example.com/health | jq '.activityEventSourcing'
```

Expected initial state:

```json
{
  "enabled": true,
  "metrics": {
    "commandsAppended": 0,
    "commandConflicts": 0,
    "projectionRepairs": 0,
    "replayFailures": 0
  }
}
```

Resume writes gradually.

Because the feature flag is process-wide, use one of these deployment patterns:

1. A maintenance-window cutover where all Activity writes move to the new version at once.
2. A canary deployment that receives all Activity write traffic while old instances receive none.
3. Traffic routing that guarantees legacy instances cannot handle Activity writes.

Do not send Activity writes to a mixed pool of legacy and event-aware instances.

## 7. Canary validation

Perform a controlled set of real operations:

- create an Activity;
- update its details;
- respond to an invitation;
- change a team or selection;
- run one Spond import;
- read the Activity afterward;
- inspect its audit events;
- verify that the projection revision equals the latest event revision.

Monitor:

- HTTP 4xx and 5xx rates;
- Activity read/write latency;
- `replayFailures`;
- `projectionRepairs`;
- command conflicts;
- duplicate idempotency-key conflicts;
- MongoDB connection and write errors;
- projection/event revision divergence.

The current metrics are process-local counters. Export or scrape them externally if durable rollout history is required.

## 8. Reconciliation and post-cutover verification

The code provides `ActivityReconciler.reconcileSquad()`, but the repository does not currently expose a production CLI or scheduled worker for it. Add or use an internal maintenance runner before treating reconciliation as complete.

Run reconciliation Squad by Squad and require:

```text
failed = 0
```

Verify that:

- no migrated Activity is missing event metadata;
- replayed state equals the projection;
- stale projections repair successfully;
- snapshot revisions never decrease;
- deleting snapshots still allows correct replay;
- audit events are isolated to the correct Squad.

## 9. Rollback and incident handling

### Projection or projector failure

1. Keep event-sourced writes enabled if the event store is healthy.
2. Stop or drain Activity traffic if necessary.
3. Fix or roll forward the projector/reconciler.
4. Rebuild affected projections from `activity-events`.
5. Re-run replay/equality checks.

Do not restore direct projection writes after event commits exist.

### Event-store or MongoDB failure

1. Freeze Activity writes.
2. Keep projections read-only if safe.
3. Restore MongoDB from the verified backup, or restore the affected event collection.
4. Rebuild projections from `activity-events`.
5. Verify replay equality and indexes.
6. Resume event-aware writes only after validation succeeds.

## 10. Completion criteria

Mark the rollout complete only when:

- all migrated Activities have matching replayed state;
- no legacy instance handles Activity writes;
- the canary and full rollout have stable error and latency rates;
- reconciliation reports zero failures;
- no replay failures are observed;
- backup restore evidence is recorded;
- monitoring and alerts are active;
- the feature flag is permanently enabled for the production deployment;
- direct projection writes are disabled or removed;
- ES-14 is updated to `Complete` in `event-sourcing-plan.md`.

## Operational notes

- Baseline imports represent the current projection state, not reconstructed historical audit history.
- Event commits are authoritative; projections and snapshots are disposable.
- A snapshot is an acceleration layer only. Deleting snapshots must never lose domain state.
- The migration is designed to be rerunnable, but writes must remain paused while it runs.
- A rollback that re-enables direct Activity writes would break audit integrity and must not be used.
