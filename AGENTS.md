# Activity aggregate

The Activity aggregate must never be changed directly; always change it through commands. Keep related selection and lineup effects within the same command and commit.

## Event sourcing rules

- Validate intent in a command, emit events only for actual changes, and replay those events to obtain the new Activity. Preserve revision checks and idempotency keys.
- When event sourcing is enabled, append the commit first. Update the projection from replayed state through `ActivityProjectionStore` with the commit ID and revision; never write it independently. Reconciliation must be able to repair a missed projection update.
- Treat stored events as permanent contracts. Do not edit or reinterpret old payloads. If an event shape changes, bump `schemaVersion` and keep replay support for every persisted version; handle unknown versions explicitly. Apply the same care to snapshot schema changes.
- Test every event-sourcing change thoroughly: valid and rejected commands, multi-event commit order, no-ops, stale revisions, idempotent retries, and concurrent writes. Assert that replay, the projection, API response, and history agree.
- Cover persisted older event and snapshot versions, migration, deletion, and recovery after a commit succeeds but projection or snapshot writing fails. Run `npm run test:ci` before considering an event-sourcing change complete.

# Repository

- Express and TypeScript API. Routes are in `src/routes`, controllers in `src/controllers`, and Activity domain logic in `src/domain`.
- Run `npm run build` and the relevant `npm run test:*` scripts after changes. Update `specs/openapi-spec.yaml` when changing API contracts.
