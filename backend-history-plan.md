# Backend Activity history and command API plan

**Status: Backend complete.** The frontend migration is deferred by request; legacy endpoints remain available.

**Scope:** Backend for Activity history and intent-specific Activity commands. Companion frontend plan: `../teams-app/history-plan.md`.

**Verification:** `npm run test:ci` passes, including command, replay, projection, migration, history, route authorization, and endpoint validation tests. Attendance reasons are persisted in `AttendanceRecorded` v2; replay and history still support v1.

## Existing foundation and constraints

- <span style="background:#dcfce7;color:#166534;border-radius:999px;padding:2px 8px">EXISTS</span> `src/routes/groupRoutes.ts` and `src/controllers/activityEventController.ts` expose admin-only `GET /api/squads/{squadId}/activity-events`; `specs/openapi-spec.yaml` documents the raw audit page. The frontend repository has an older copy of the spec without that route.
- <span style="background:#dcfce7;color:#166534;border-radius:999px;padding:2px 8px">EXISTS</span> `src/controllers/activityController.ts` parses `If-Match: "activity-revision-N"` and `Idempotency-Key`; `src/domain/activityCommandService.ts` checks revisions and keys. The current revision conflict response is `409`. Reads and some writes set ETags. Audit all write paths and ensure the response ETag is the post-write revision.
- <span style="background:#dcfce7;color:#166534;border-radius:999px;padding:2px 8px">EXISTS</span> `src/domain/activityCommands.ts` emits new-value events and `src/domain/activityAggregate.ts` replays them. `TeamChanged` carries the new Team state, `ActivityDetailsChanged` changed values, and `LineupChanged` the new lineup. Existing event payloads need no before-value migration.
- <span style="background:#dcfce7;color:#166534;border-radius:999px;padding:2px 8px">EXISTS</span> The invitation response controller already removes unaccepted players from teams within the Activity before persisting, but the UI also makes a second selection write. Review the exact lineup and attendance effects before changing this flow.
- Commands in this plan may change the Activity aggregate only. They must not silently mutate member, player, or squad records. A complete Activity response lets the UI replace one store slice and recompute selectors.
- “Selection sent” is internal planning state, not a notification. The WhatsApp message link is separate and does not establish delivery. Existing stored `SelectionPublished` events can be rendered as “Selection marked as sent” without renaming or rewriting them.

## New command endpoints and exact request shapes

Base path: `/api/squads/{squadId}/activities/{activityId}`. All successful commands return the **complete updated Activity** and the new `ETag: "activity-revision-N"`. Preserve the current `If-Match`, `Idempotency-Key`, `409` revision conflict (`expectedRevision`, `actualRevision`), role authorization, and activity lifecycle checks. Use `400` for validation and `404` for missing Activity/team. PATCH omission means unchanged; `null` clears a nullable field. The server creates timestamps and computes the event diff; no prior values are accepted from clients.

| Status | Method and path | Request JSON | Authorization and effect |
| --- | --- | --- | --- |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `PATCH /details` | Changed subset of `{ "kind": "match", "name": "Match", "startsAt": "2026-10-28T09:00:00.000Z", "endsAt": null, "location": null, "opponentName": null, "matchFormatId": null, "minPlayersPerTeam": 6, "maxPlayersPerTeam": 9 }` | Admin/trainer; details only. Reject unrelated keys, including teams/invitations/status. Apply existing format, schedule, limit, and Spond-managed-field rules. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `POST /teams` | `{ "id": "client-uuid", "name": "Team 2", "strength": 2, "startTime": "09:00" }` | Admin/trainer; add one team. Keep current match/tournament count rules. Idempotency key prevents duplicate add. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `PATCH /teams/{teamId}/details` | Changed subset of `{ "name": "Red", "strength": 1, "startTime": null, "location": null, "meetingTime": "08:45", "meetingLocation": "Clubhouse" }` | Admin/trainer; only this team's descriptive fields. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `PUT /teams/{teamId}/responsible-person` | `{ "responsiblePersonId": "member-7" }` or `{ "responsiblePersonId": null }` | Admin/trainer; validate eligible member and selection-sent invariant. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `PUT /teams/{teamId}/formation` | `{ "formationId": "formation-3" }` or `null` | Admin/trainer; validate match format and formation compatibility. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `PUT /teams/{teamId}/shirts` | `{ "shirtSetId": "set-1", "assignments": [{ "playerId": "p1", "shirtNumber": 8 }] }` | Admin/trainer; atomic shirt set and assignment save, with ownership and uniqueness validation. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `PUT /teams/{teamId}/lineup` | `{ "periods": [{ "periodNumber": 1, "assignments": [{ "slotId": "GK", "playerId": "p1" }] }] }` | Admin/trainer; full lineup for this team, valid periods/slots/selected players only. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `POST /teams/{teamId}/selection-changes` | `{ "add": ["p2"], "remove": [{ "playerId": "p1", "reason": "sick" }] }` | Admin/trainer; atomic delta. Reason is required after selection was marked sent and omitted before. Server adds `removedAt`, validates accepted invitations, capacity, uniqueness, timing, and lineup cleanup. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `POST /invitations` | `{ "players": [{ "playerId": "p1", "response": "open" }] }` | Admin/trainer; atomic batch, one invitation per player. Server generates invitation IDs unless client IDs are explicitly needed for retries. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `DELETE /invitations/{playerId}` | No body | Admin/trainer; remove one invitation and reconcile selection/lineup within the Activity atomically. |
| <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 8px">DONE</span> | `PATCH /attendance` | `{ "changes": [{ "personId": "p1", "status": "excused", "reason": "sick" }] }`; `status: null` removes a record | Admin/trainer; atomic changed-row batch. Validate eligible selected players and activity start time. |
| <span style="background:#dcfce7;color:#166534;border-radius:999px;padding:2px 8px">KEEP</span> | `PUT /invitations/{playerId}`, `PUT /status`, `PUT /selection/sent` | Existing narrow request bodies | Keep paths and semantics; standardize complete updated Activity + post-write ETag. |

Do not delete broad `PUT /activities/{id}`, `/teams`, `/selection`, `/invitations`, or `/attendance` until clients migrate. Mark them deprecated in OpenAPI after the new endpoints are active. Create an intent-specific command type for each new operation in `activityCommands.ts` or a bounded command handler; avoid turning the new controllers into disguised full-array replacement APIs.

## Enriched history read endpoint

<span style="display:inline-block;background:#dbeafe;color:#1e40af;border-radius:999px;padding:2px 10px;font-weight:600">DONE</span> `GET /api/squads/{squadId}/activities/{activityId}/history`, admin-only like the existing raw audit endpoint. Return all commits in display order (newest first), with changes in stored ordinal order. No backend pagination is required for this Activity-scoped view; replay roughly 100 events directly. Keep the raw endpoint unchanged.

```json
{
  "items": [
    {
      "id": "commit-42",
      "revision": 42,
      "recordedAt": "2026-10-27T10:15:00.000Z",
      "actor": { "type": "user", "memberId": "member-7", "displayName": "Alex Coach" },
      "changes": [
        {
          "type": "invitation.responseChanged",
          "subject": { "type": "player", "id": "p1", "displayName": "Sam Player" },
          "field": "response",
          "previous": "open",
          "current": "declined"
        },
        {
          "type": "selection.playerRemoved",
          "subject": { "type": "player", "id": "p1", "displayName": "Sam Player" },
          "context": { "teamId": "team-3", "teamName": "Red", "reason": "sick" }
        },
        {
          "type": "lineup.changed",
          "subject": { "type": "team", "id": "team-3", "displayName": "Red" },
          "context": { "periods": [1], "assignmentChanges": 1 }
        }
      ]
    }
  ]
}
```

Define OpenAPI schemas for the page, actor, subject, and each discriminated change type. `previous`/`current` are typed JSON values; for an explicitly cleared optional value use `null`, and omit those properties where they are not meaningful. `context` must have a schema by change type. The API returns stable, language-neutral codes and raw date/time values, never an English sentence. For `ActivityDetailsChanged` and `TeamChanged`, compare replay state immediately before and after each event and emit one display change per changed field. For lineup, compare periods and assignments at the same boundary. Preserve one history item per commit and one line per meaningful change. Actor and subject names may resolve from current member records; this is not historical name reconstruction. Team names can be taken from the relevant replay state. Unresolved names are `null` with stable IDs intact. Unknown/unsupported event versions must yield an explicit safe fallback rather than an invented field diff. Check existing older imported and migration events.

## Side-effect boundary and decision point

**Resolved:** An invitation response removes an unaccepted player from every affected lineup period in the same Activity commit. Selection cannot change after the Activity starts or attendance is recorded; attendance can only be recorded after the start. The frontend's second `/selection` write remains for the deferred frontend migration.

**Boundary retained:** If a future command affects a player, member, squad, or another Activity, define explicit affected-resource metadata or a separate orchestration contract and a client refresh strategy first. Cross-entity effects remain out of scope.

## Delivery status

- [x] Enriched history read model, admin route, OpenAPI schemas, and replay tests.
- [x] Complete Activity responses and post-write ETags on narrow writes; `409` revision conflict retained.
- [x] Intent-specific Activity commands for details, teams, assignments, selection, invitations, and attendance.
- [x] Attendance reason support with versioned events and v1 replay compatibility.
- [x] Backend build, full CI suite, and focused controller, command, replay, history, authorization, and OpenAPI checks.
- [ ] Frontend migration and later legacy endpoint removal: deferred by request.
