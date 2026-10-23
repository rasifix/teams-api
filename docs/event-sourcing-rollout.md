# Activity event-sourcing rollout

Event-first Activity writes remain disabled unless
`ACTIVITY_EVENT_SOURCING_ENABLED=true` is explicitly configured. The existing
`events` collection remains the compatibility projection throughout the
rollout.

## Stages

1. **Prepare**: take and verify a MongoDB backup, confirm the backup restore in
   an isolated database, and pause Activity writes during baseline migration.
2. **Migrate**: run `migrateActivityProjections`, record scanned/imported/
   verified/mismatch counts, and stop if any mismatch is reported.
3. **Shadow**: keep the flag disabled, replay and compare migrated streams,
   and monitor `/health` for event-sourcing counters.
4. **Canary**: enable the flag for one deployment or controlled environment;
   monitor command conflicts, projection repairs, replay failures, and API
   error rates.
5. **Expand**: increase exposure only after the canary remains healthy and a
   second backup/restore check succeeds.
6. **Contract**: remove direct projection writes only after the migration,
   repair, restore, and rollback acceptance checks have passed.

## Operational checks

- `commandsAppended` should increase with successful event-first writes.
- `commandConflicts` indicates stale `If-Match` revisions or concurrent writes.
- `projectionRepairs` should be zero during steady state; investigate spikes.
- `replayFailures` must remain zero before expanding the canary.
- A mismatch or failed restore blocks rollout and keeps the feature flag off.

The rollout is intentionally not considered complete until the backup restore
drill has been performed against the deployment's real MongoDB backup process.
