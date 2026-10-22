# Activity Event Sourcing Refactoring Plan

## Status

| Item | Status |
| --- | --- |
| Document status | Proposed |
| Discovery and architecture decisions | Complete |
| Naming and public API alignment | Complete |
| Event-sourcing implementation | In progress (ES-03 review) |
| Data migration | Not started |
| Production rollout | Not started |
| Last reviewed | 2026-10-22 |

## Current implementation status

The public API now uses Squad and Activity terminology. The unused Event API has been removed from the backend OpenAPI specification and route surface, while the existing MongoDB `events` collection and its historical document shape remain untouched for migration safety.

The following event-sourcing capabilities are not implemented yet:

- No append-only activity event collection exists.
- No Activity aggregate, reducer, command handler, or event upcaster exists.
- Activity writes still update the existing projection directly.
- Existing activities have not been converted into baseline events.
- No replay-vs-projection comparison or reconciler exists.
- No audit-event endpoint, revision headers, or idempotency handling exists.

## Implementation-sized task backlog

Tasks are intentionally scoped to one focused change set. A task is complete only when its code, tests, and documentation are included. `S` is up to one day, `M` is one to three days, and `L` is three to five days; larger work must be split before implementation.

| ID | Task | Size | Depends on | Status | Completion criteria |
| --- | --- | --- | --- | --- | --- |
| ES-01 | Align public Activity/Squad vocabulary and document the persistence boundary | S | — | Complete | Public types and API documentation use Activity/Squad; historical projection names are documented as compatibility details. |
| ES-02 | Define versioned `DomainEvent`, `ActivityEvent`, actor snapshot, command metadata, and stream identity types | M | ES-01 | Complete | Types compile and fixtures cover every planned event envelope field. |
| ES-03 | Add the `activity-events` MongoDB collection, validation, indexes, and append-only repository | M | ES-02 | In review | Repository supports append and ordered stream reads but exposes no update/delete operation. |
| ES-04 | Add projection metadata fields and conditional projection-write helpers | M | ES-03 | Not started | Existing Activity documents remain readable; projection updates cannot regress revisions. |
| ES-05 | Implement the pure Activity aggregate reducer and replay service | L | ES-02 | Not started | All planned event types replay into a complete Activity state with fixtures for each Activity kind and lifecycle. |
| ES-06 | Implement Activity command handlers and semantic state diffing | L | ES-05 | Not started | Create, update, invitation, selection, team, attendance, import, cancellation, and deletion commands produce deterministic event batches and reject invalid transitions. |
| ES-07 | Route Activity and Spond-import writes through event-first dual persistence | L | ES-03, ES-06 | Not started | A successful command appends one commit first, updates the existing projection second, and returns event-derived state. |
| ES-08 | Add baseline migration from existing projections to `ActivityImported` commits | M | ES-03, ES-05 | Not started | Migration is paused-write, deterministic, rerunnable, count-checked, and leaves source projection documents intact. |
| ES-09 | Add canonical replay/projection comparison and mismatch diagnostics | M | ES-04, ES-05, ES-08 | Not started | Every migrated Activity compares equal after normalization; mismatches include Squad, Activity, revision, and field-level differences. |
| ES-10 | Add read-time repair and the background projection reconciler | L | ES-07, ES-09 | Not started | Missing or stale projections rebuild idempotently; stale rebuilds cannot overwrite newer state. |
| ES-11 | Add revision concurrency, ETags, `If-Match`, idempotency keys, and command IDs | M | ES-07 | Not started | Concurrent writes produce `409`; identical retries return the original result; mismatched retries are rejected. |
| ES-12 | Add the Squad-scoped audit-events endpoint and authorization tests | M | ES-03, ES-07 | Not started | Admins can filter and paginate logical events within their Squad; other Squads and restricted data remain inaccessible. |
| ES-13 | Add migration, replay, failure-recovery, and load-test coverage | M | ES-08, ES-10 | Not started | CI covers replay equality, crash-after-commit recovery, projection corruption, concurrent writes, rerunnable migration, and production-scale lists. |
| ES-14 | Execute staged rollout, monitoring, backup verification, and contract cleanup | M | ES-11, ES-12, ES-13 | Not started | Feature flag rollout succeeds, metrics and alerts are active, restore drill passes, and direct projection writes are disabled. |

### Recommended implementation order

Implement tasks in dependency order: ES-02 → ES-03 → ES-04/ES-05 → ES-06 → ES-07 → ES-08/ES-09 → ES-10/ES-11/ES-12 → ES-13 → ES-14. ES-01 is complete and is the naming baseline for all remaining work.

Do not begin the baseline migration or enable event-first writes until ES-05, ES-07, and their replay/equality tests are complete. Do not remove or repurpose the existing projection until ES-13 and the backup-restore acceptance criteria pass.

The first iteration covers Activities only. MongoDB remains a standalone deployment for cost reasons. Immutable event documents are the source of truth; projections are disposable and must detect and repair stale state.

## Summary

Refactor the Activity domain as the initial event-sourcing pilot. Store every successful Activity command as an immutable event commit and use the existing `events` collection as a read projection.

Preserve the current `/api/squads/{squadId}/activities` endpoints. Reads remain immediately consistent from a client's perspective: before returning data, the API compares the projection revision with the event store and rebuilds missing or stale projections.

Squads, members, guardian links, shirt sets, user accounts, and password-reset workflows remain conventionally persisted in this phase.

Public terminology is deliberately separate from historical persistence terminology. The API and domain use `Squad` and `Activity`; the existing MongoDB projection retains its historical `events` collection name and `groupId` field until a separately planned data migration makes changing them safe.

## MongoDB document model

### `activity-events`

Store one document per accepted command. A commit can contain several ordered semantic events, allowing all consequences of one command to be persisted atomically in a single MongoDB document without transactions.

```json
{
  "_id": "01J...ULID",
  "streamId": "activity:squad-12:activity-91",
  "aggregateType": "activity",
  "aggregateId": "91",
  "squadId": "12",
  "revision": 17,
  "command": {
    "type": "RespondToInvitation",
    "idempotencyKey": "client-key-or-null",
    "requestHash": "sha256:..."
  },
  "actor": {
    "type": "user",
    "userId": "user-4",
    "memberId": "member-8",
    "displayName": "Jane Smith",
    "roles": ["guardian"]
  },
  "recordedAt": "2026-10-10T09:41:12.123Z",
  "correlationId": "request-uuid",
  "events": [
    {
      "ordinal": 0,
      "type": "InvitationResponseChanged",
      "schemaVersion": 1,
      "data": {
        "playerId": "player-7",
        "response": "declined",
        "declineReason": "sick",
        "respondedBy": "member-8"
      }
    },
    {
      "ordinal": 1,
      "type": "PlayerUnselected",
      "schemaVersion": 1,
      "data": {
        "teamId": "team-2",
        "playerId": "player-7",
        "reason": "invitation-declined"
      }
    }
  ]
}
```

Apply these rules and indexes:

- Treat commit documents as append-only. Application persistence code must expose no update or delete operation for them.
- Order commits by `revision` and logical events within a commit by `ordinal`.
- Add a unique `{ streamId: 1, revision: 1 }` index for optimistic concurrency.
- Add `{ squadId: 1, aggregateId: 1, revision: 1 }` for stream replay.
- Add `{ squadId: 1, recordedAt: -1, _id: -1 }` for audit pagination.
- Add a partial unique index on `{ squadId: 1, "command.idempotencyKey": 1 }` where an idempotency key exists.
- Generate `recordedAt` on the server. Never trust a client-supplied audit timestamp.
- Retain the actor's IDs, display name, and roles at the time of the action, but do not copy email addresses into immutable events.
- Reject commands whose serialized commit could approach MongoDB's 16 MB document limit.

No stream-head document is authoritative. Such a document could itself drift because the standalone deployment cannot update it atomically with the event commit.

### `events` read projection

Retain the current document shape and indexes for API compatibility, with additional projection metadata:

```json
{
  "_id": "91",
  "groupId": "12",
  "kind": "match",
  "name": "FC Example",
  "startsAt": "2026-11-04T18:00:00.000Z",
  "teams": [],
  "invitations": [],
  "attendance": [],
  "tasks": [],
  "projectedRevision": 17,
  "projectedCommitId": "01J...ULID",
  "projectionSchemaVersion": 1,
  "projectionUpdatedAt": "2026-10-10T09:41:12.150Z",
  "deletedAt": null
}
```

Deleted activities remain as projection tombstones and are filtered from normal queries. Do not introduce separate snapshots initially: the projection supplies fast reads, while full replay remains the tested recovery mechanism. Add non-authoritative snapshots later only if measured replay time warrants them.

## Implementation plan

### Aggregate and event model

- Introduce an activity aggregate with a pure event-folding function, command handlers, invariant validation, and versioned event upcasters.
- Define replayable domain events including:
  - `ActivityCreated`, `ActivityImported`, `ActivityDetailsChanged`, and `ActivityDeleted`.
  - `InvitationAdded`, `InvitationRemoved`, and `InvitationResponseChanged`.
  - `TeamAdded`, `TeamChanged`, `TeamRemoved`, `PlayerSelected`, `PlayerUnselected`, and `LineupChanged`.
  - `SelectionPublished`.
  - `AttendanceRecorded` and `AttendanceRemoved`.
  - `TaskCreated`, `TaskChanged`, `TaskDeleted`, `TaskSignupAdded`, and `TaskSignupRemoved`.
  - `TrainingPlanChanged`.
- Events must contain enough domain data to rebuild state, rather than only human-readable descriptions.
- Bulk and Activity `PUT` requests compare the submitted state with the reconstructed aggregate and emit an ordered semantic-event batch. Cascading effects, such as removing a player after an invitation is declined, become explicit events in the same commit.

### Command write path

For every activity mutation:

1. Read and replay the stream to obtain state at revision `N`.
2. Authorize the actor and validate the command against that state.
3. Produce zero or more semantic events. A true no-op returns the existing state without adding misleading audit history.
4. Insert one commit at revision `N + 1`.
5. Return `409 Conflict` if the unique stream/revision index detects a concurrent writer.
6. Apply the committed events to the projection on a best-effort basis.
7. Return the state calculated from the committed events, regardless of whether the projection update succeeded.

Route all Activity writes, including Spond imports, through the same command layer so no supported endpoint can bypass the audit trail.

### Projection consistency and recovery

- For a single-activity read, obtain the latest event revision, compare it with `projectedRevision`, and replay/upsert the projection when it is missing or stale.
- For list reads, aggregate the latest revision per Activity for the Squad, batch-rebuild stale or missing projections, and omit tombstones.
- After rebuilding, recheck the latest revision. Repeat if another commit arrived during recovery so stale state is not returned.
- Add a background reconciler that performs the same comparison and repair proactively. Correctness must not depend on that job running.
- Treat projection failures as recoverable cache failures. Log and measure them without rolling back or hiding an already committed source event.
- Make projection handlers idempotent and use conditional updates so an older rebuild cannot overwrite a newer projection.

## Public interfaces and audit API

- Preserve existing request and response bodies.
- Return an `ETag` representing the aggregate revision on activity reads and writes.
- Accept optional `If-Match` and return `409 Conflict` when it names an obsolete revision.
- Initially accept an optional `Idempotency-Key` header for activity writes. Store its request hash and return the previously committed result for an identical retry; return `409` when the key is reused with a different request.
- Make `Idempotency-Key` mandatory only after all supported clients have migrated.
- Return `X-Command-Id` for support and trace correlation.
- Add an admin-only audit endpoint:

```http
GET /api/squads/{squadId}/audit-events
    ?aggregateId=91
    &eventType=InvitationResponseChanged
    &actorMemberId=member-8
    &from=...
    &to=...
    &cursor=...
    &limit=50
```

Return flattened logical events containing commit ID, revision, event ordinal and type, server timestamp, actor snapshot, Activity ID, structured change data, and a stable pagination cursor. Enforce Squad isolation and never expose authentication data.

## Migration and rollout

1. Add event types, persistence code, collection validation, indexes, projector, audit endpoint, reconciliation metrics, and a feature flag without changing the active write path.
2. Back up MongoDB and briefly pause activity writes.
3. For every current `events` projection document, append one deterministic and idempotent `ActivityImported` revision-1 commit containing its normalized complete state and the document's Squad identity.
4. Attribute baseline commits to a system migration actor. Preserve legacy creation and update timestamps only as source metadata; do not present them as reconstructed history.
5. Update the existing document with projection metadata and verify that full replay reproduces its canonical activity representation.
6. Verify document counts, references, checksums, replay results, and indexes, then enable event-sourced writes.
7. Resume writes, run the reconciler, and monitor projection lag, rebuild failures, conflicts, replay duration, duplicate idempotency keys, and audit latency.

Pre-cutover audit history must be presented as a baseline import. Historical actors and changes cannot truthfully be reconstructed.

After cutover, a rollback may serve projections read-only, but activity writes must be frozen until an event-aware version is restored. Re-enabling direct projection writes would break audit integrity.

## Risks

Likelihood and severity use `Low`, `Medium`, `High`, and `Critical` relative to this service.

| Risk | Likelihood | Severity | Mitigation |
| --- | --- | --- | --- |
| A process stops after committing an event but before updating its projection | High | Medium | Treat events as authoritative; verify revisions on every read; use the reconciler and idempotent projection handlers. |
| A client retries after a commit succeeded but its HTTP response was lost | Medium during transition | High | Support idempotency keys immediately, return command IDs, and make keys mandatory after client migration. |
| Concurrent commands target the same activity revision | Medium | Medium | Enforce the unique stream/revision index, return `409`, expose ETags, and require callers to reload before retrying. |
| Standalone MongoDB suffers host or disk failure and loses acknowledged events | Low to Medium | Critical | Use durable storage, frequent tested backups, appropriate write concern and journaling, infrastructure monitoring, and a documented restore procedure. Event sourcing is not a substitute for replication or backups. |
| List reads become expensive because they must determine the latest revision for every activity | Medium | High as data grows | Use the compound replay index, batch revision aggregation, proactive reconciliation, load tests, and measured thresholds for introducing snapshots or another cache. |
| A projector bug builds plausible but incorrect state | Medium | High | Keep reducers pure, test replay exhaustively, version projection schemas, compare migration checksums, and make projections disposable. |
| Semantic diffing of whole-document Activity `PUT` requests emits incorrect or incomplete events | Medium | High | Centralize canonicalization and diffing, add contract tests for every Activity route, and compare pre/post aggregate state in tests. |
| Future code updates or deletes immutable event documents | Low | Critical | Isolate event persistence behind an append-only interface, use MongoDB validation and restricted database credentials where practical, and alert on unexpected mutations. |
| Event payload schemas evolve and old streams can no longer be replayed | Medium | High | Version every event, maintain upcasters and replay fixtures, and require full historical replay in CI before deployment. |
| Immutable audit data conflicts with privacy or retention obligations | Medium | High | Store only necessary actor identity, exclude email and secrets, define retention/legal policy before production, and document any required anonymization strategy. |
| A command produces an oversized commit document | Low | High | Validate serialized size, limit bulk request sizes, and design large operations as multiple explicitly tracked commands when atomicity is not required. |
| Migration races with live activity writes | Medium without controls | High | Pause activity writes, use deterministic migration command IDs, make migration rerunnable, and verify revisions before enabling the new path. |
| The baseline import is mistaken for complete historical audit data | Medium | Medium | Label it explicitly as a system migration and communicate that reliable actor history begins at cutover. |
| A stale rebuild overwrites a newer projection | Medium | High | Use conditional projection updates based on `projectedRevision` and recheck the event-store revision before responding. |
| The audit endpoint leaks another Squad's or guardian-restricted data | Low | Critical | Restrict it to Squad admins, reuse Squad authorization, test tenant isolation, and return only the approved audit DTO. |

The largest accepted architectural risk is standalone MongoDB durability. Projection inconsistency is recoverable because events are authoritative; loss of the standalone event database is not. Backups and restore drills are therefore release prerequisites.

## Test and acceptance plan

- Unit-test every command-to-event transition, invariant, fold, semantic diff, cascade, and upcaster.
- Prove full replay for matches, tournaments, training, social activities, invitations, selections, teams, lineups, attendance, tasks, training groups, and deletion tombstones.
- Verify that two concurrent writers cannot commit the same next revision and that the loser receives `409`.
- Test idempotent retries, mismatched request hashes, optional-key compatibility, and recovery after a lost response.
- Delete, corrupt, and deliberately lag projections; verify that detail and list reads reconstruct correct state from events.
- Simulate a crash after commit insertion but before projection update; verify recovery on the next read and by the reconciler.
- Verify conditional projection writes cannot regress `projectedRevision`.
- Run existing Activity, permission, guardian-filtering, alias, and compatibility tests unchanged.
- Test admin-only audit access, Squad isolation, filters, cursor pagination, actor snapshots, and ordering within multi-event commits.
- Run the migration twice to prove idempotence, then compare source documents with fully replayed aggregates.
- Load-test Squad Activity lists and stream replay using production-scale event counts.
- Test backup restoration and rebuild every activity projection from the restored event collection.

The refactor is ready for production only when all existing API tests pass, migrated aggregates replay identically, deliberately stale projections self-heal, concurrent writes are rejected safely, audit results identify who did what and when, and a backup restore drill succeeds.
