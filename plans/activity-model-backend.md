# Activity domain model: backend plan (teams-api)

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.
Overview: `teams-app/plans/activity-model-overview.md`. Target model: `teams-app/brainstorming/typespec/main.tsp`.

## Compatibility strategy (expand, then contract)

Goal: the current frontend and any existing API consumer keep working, unchanged, through
every phase until the contract phase (C). Rules:

1. **Additive only.** No existing route, field, status value or response shape changes meaning
   or disappears before phase C. New behavior is reachable through new routes/fields.
2. **API-layer renames, no DB renames.** Squad/MatchFormat arrive as route aliases and
   field aliases. MongoDB collections (`groups`, `events`) and stored field names stay until phase C.
3. **One store, two views.** Activities are stored in the existing `events` collection,
   extended with optional new fields. Legacy documents (no `kind`) stay valid and are
   interpreted on read; no big-bang data migration is needed.
   - `/events` returns the legacy shape; `/activities` returns the new shape; both are mapped
     from the same document in `src/types/mappers.ts`.
4. **Lossless two-way mapping.** Every legacy write maps into the new storage fields without
   information loss, and every new write is readable through the legacy view:

   | Legacy (`/events`) | New (`/activities`) | Storage |
   |---|---|---|
   | invitation `status` open/accepted/declined | `response` | store `response` (+ keep `status`) |
   | invitation `status` injured/sick/unavailable | `response: declined` + `declineReason` | store both; legacy view derives `status = declineReason ?? response` |
   | team `trainerId` | `responsiblePersonIds[]` | store array; legacy view `trainerId = first`; legacy write `trainerId` → `[trainerId]` |
   | team `status: new/selected` | activity `selectionSentAt` | keep `status`; set `selectionSentAt` when a team becomes `selected` |
   | `eventDate` + team `startTime` | `startsAt` | keep `eventDate`; `startsAt` derived for legacy docs, stored for new |
   | `playingModeId` | `matchFormatId` | accept both on input; store one, return both |
   | no `kind` | `kind` | derived on read: 1 team → `match`, otherwise `tournament`; stored explicitly on new docs |

5. **Guarded by characterization tests.** Before touching anything, record the current
   behavior of all existing endpoints as contract tests; they must stay green in every phase.
6. **Contract first.** Update `specs/openapi-spec.yaml` before implementing; mark deprecated
   routes/fields with `deprecated: true`, never remove them before phase C.
7. **Each phase is independently deployable and reversible** (feature code only; no
   destructive migration before phase C).

## Phase 0: safety net

- [x] B0.1 Characterization tests for existing endpoint response families, using fixtures and schema assertions, runnable via `tsx` and added to `test:ci`
- [x] B0.2 Compatibility-test mechanism: schema assertions (required fields and types; additive fields remain allowed)
- [x] B0.3 Backup/restore note for the Mongo data used in later phases

## Phase 1: aliases and cleanup (no behavior change)

- [x] B1.1 Mount all `/api/groups/:groupId/...` routes also under `/api/squads/:squadId/...` (same handlers; `groupId` param resolved from either)
- [x] B1.2 Squad naming in responses is opt-in: responses keep `Group` shape; `/squads` routes return the same payload with `id`/`name` unchanged (field names are already neutral); document aliases in OpenAPI
- [x] B1.3 `/api/squads/:id/match-formats` alias for `/playing-modes`; `matchFormats` accepted/returned next to `playingModes` on the squad payload; event `matchFormatId` accepted next to `playingModeId`
- [x] B1.4 `birthYear`: derive read-only from `birthDate` and accept `birthDate` as canonical input (user confirmed the data audit is complete).
- [x] B1.5 Guardian `userId`: remove the legacy field from application types, storage projections, and API schema after the user confirmed migration is complete
- [x] B1.6 Tests: alias parity and permissions run against both route families

## Phase 2: SFV catalog and match formats (additive)

- [x] B2.1 Catalog values supplied by the user; versioned `sfvCategories` module records the supplied-data source and date (not independently verified against an SFV publication)
- [x] B2.2 `GET /api/sfv-categories` (authenticated, read only)
- [x] B2.3 Squad creation with `category`: copy supplied formats into the squad's formats with `origin`; existing squads untouched
- [x] B2.4 New optional MatchFormat fields (`playersOnField`, `minPlayersPerTeam`, `maxPlayersPerTeam`, `origin`); legacy formats remain valid without them
- [x] B2.5 Tests: creation copy, default handling, no format seeding for tournament-only categories, and preservation of existing formats on category updates

## Phase 3: activities (new view over the events store)

- [x] B3.1 OpenAPI: activity schemas per kind, new invitation shape, `responsiblePersonIds`, `selectionSentAt`
- [x] B3.2 Extend `EventDocument` with optional `kind`, `startsAt`, `endsAt`, `matchFormatId`, `opponentName`, `selectionSentAt`; invitations get optional `response`, `declineReason`, `respondedBy`; teams get optional `responsiblePersonIds`
- [x] B3.3 Mappers: `eventDocumentToLegacyEvent` (unchanged output, fed by new storage) and `eventDocumentToActivity` (new output)
- [x] B3.4 Legacy write path (`/events`) writes both representations (new fields derived from legacy input)
- [x] B3.5 New activity CRUD, filters, invitation responses, selection, and team routes
- [x] B3.6 New-write invariants; legacy writes retain their existing validation
- [x] B3.7 `training`/`social` are excluded from `/events`
- [ ] B3.8 Optional backfill script (idempotent, dry-run); not implemented because it is not required for correctness
- [x] B3.9 Tests: legacy/activity mapping round trips, guardian invitation response, selection invariants, and preservation of selected players and lineup data
- [x] B3.10 Automated legacy-frontend HTTP compatibility test covers `/events` list/detail/create/update/invitation/selection flows against shared event storage and asserts the legacy payload shape

## Phase 4: attendance (additive)

- [x] B4.1 Optional `attendance[]` on activity docs (`personId`, `present|absent|excused`); ignored by `/events`
- [x] B4.2 `PUT /activities/:id/attendance` (bulk and per person), only after `startsAt`; independent of invitation and selection
- [x] B4.3 Attendance edits are admin/trainer-only; membership and after-start checks covered by tests

## Phase 5: tasks (additive)

- [x] B5.1 Optional `tasks[]` (`id`, `name`, `description?`, `requiredPeople ≥ 1`, `signups[]`); `isFulfilled` computed on read; ignored by `/events`
- [x] B5.2 Task management is admin/trainer-only; adult squad members sign themselves up once per task; guardians cannot sign up children; over-subscription is allowed
- [x] B5.3 Update `permission-model.md`; test permissions, idempotent signup, withdrawal, over-subscription, and computed fulfillment

## Phase 6: training and social (additive)

- [x] B6.1 `training`: `trainerIds[]` (≥ 1), `groups[]` → `units[]` → `plannedPlayerIds[]` (accepted invitees only)
- [x] B6.2 `social`: no teams, no limits
- [x] B6.3 Kind-specific validation; tests; legacy event reads and deletes ignore training/social; no event-statistics implementation exists in this API to update

## Phase C: contract (only after the frontend no longer uses legacy paths)

- [ ] BC.1 Usage check: log/metrics show no traffic on `/events`, `/groups`, `playingModeId`, `trainerId`, invitation `status`
- [ ] BC.2 Remove deprecated routes and legacy fields; rename collections (`groups`→`squads`, `events`→`activities`) and `groupId`→`squadId` with a backup-first migration
- [ ] BC.3 Remove derived `birthYear`
- [ ] BC.4 Finalize `specs/openapi-spec.yaml`, `domain-model.md`, `permission-model.md`, `README-OpenAPI.md`

## Open questions

| # | Question | Needed by | Status |
|---|---|---|---|
| Q1 | Kind derivation for legacy events with zero teams | B3.3 | [x] Zero teams → tournament; exactly one team → match; otherwise tournament |
| Q2 | Source and versioning of SFV official match formats | B2.1 | [x] User-supplied data; source and version date recorded in catalog |
| Q3 | Task signup adults-only; guardians cannot sign up children; over-subscription allowed | B5.2 | [x] |
| Q5 | Attendance edits are admin/trainer-only and only after activity start | B4.3 | [x] |

## Files mainly affected

`src/types/{index,mongodb,mappers}.ts`, `src/controllers/{event,group,playingMode,members}Controller.ts`,
`src/routes/*`, `src/middleware/groupAuth.ts`, `specs/*`, `test/*`.
New: `activityController`/routes, `sfvCategories` module + controller, task and attendance handlers.

## Change log

| Date | Change |
|---|---|
| 2026-10-09 | Plan created (compatible expand/contract approach) |
