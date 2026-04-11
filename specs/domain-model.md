# Domain Model

## Purpose

This document describes the core business domain model for the Teams API.
It is implementation-oriented and aligned with current TypeScript and MongoDB structures.

Scope:
- Group and membership model
- Event and team planning model
- Invitations and evaluations
- Shirt inventory model
- Authentication-related domain entities

Non-scope:
- Endpoint definitions (see openapi-spec.yaml)
- Detailed permission rules (see specs/permission-model.md)

## Bounded Context

Primary bounded context: Group Sports Operations

A Group is the top-level boundary for:
- Members (players and trainer-type members)
- Periods
- Events and teams
- Shirt sets
- Guardian-child relationships

Most entities are group-scoped and must not cross group boundaries.

## Core Entities

### Group

Represents an organizational unit (for example a team age group or squad).

Attributes:
- id
- name
- club (optional)
- periods[] (embedded)
- createdAt, updatedAt

Responsibilities:
- Serves as aggregate boundary for operational data
- Holds planning periods used by downstream features

### Member (Person)

Represents a person in a group. Stored in a unified members collection.

Shared attributes:
- id
- groupId
- firstName, lastName (optional)
- roles[]: admin | trainer | guardian | player (authorization/profile roles)
- email (optional)
- createdAt, updatedAt

Notes:
- The model supports multi-role membership through roles[].
- roles[] is the single role source of truth.

### Player (Member subtype)

A member whose roles[] contains player.

Additional attributes:
- birthDate (visibility: trainer, admin)
- level (1-5) (visibility: trainer, admin)
- preferredShirtNumber (optional)
- status: active | trial | inactive
- evaluations[] (embedded) (visibility: trainer, admin)

Compatibility view:
- API responses may include guardians[] for players.
- guardians[] is currently hydrated from canonical guardian-child links, not used as source of truth.

### Trainer-type Member

A member whose roles[] contains trainer and/or admin and/or guardian.

Typical role combinations:
- trainer
- admin
- guardian

Examples:
- Admin only
- Trainer + admin
- Guardian only
- Trainer + guardian

### GuardianChildLink

Canonical many-to-many relation between guardian members and player members.

Attributes:
- id
- groupId
- guardianMemberId
- childMemberId
- createdAt, updatedAt

Semantics:
- Canonical source of parent/child linkage
- Enables one guardian to be linked to multiple children
- Enables one child to have multiple guardians
- Preserves compatibility by enabling derived player.guardians responses

### Event

Represents a scheduled competition/training event for a group.

Attributes:
- id
- groupId
- name
- date
- maxPlayersPerTeam (visibility: trainer, admin)
- minPlayersPerTeam (visibility: trainer, admin)
- location (optional)
- teams[] (embedded)
- invitations[] (embedded)

### Team (embedded in Event)

Represents a team allocation inside an event.

Attributes:
- id
- name
- strength (1-3) (visibility: trainer, admin)
- startTime (HH:MM)
- location (optional, overrides event location)
- selectedPlayers[] (player member IDs)
- trainerId (optional, member ID)
- shirtSetId (optional)
- shirtAssignments[] (optional)

### Invitation (embedded in Event)

Represents an invitation of a player to an event.

Attributes:
- id
- playerId
- status: open | accepted | declined | injured | sick | unavailable

### PlayerEvaluation (embedded in Player)

Represents an evaluation snapshot for a player. Player evaluations must be hidden
from guardians and players. Only admins and trainers are allowed to see them.
Trainers are the only ones that can create evaluations.

Attributes:
- id
- playerId
- evaluationDate
- userId (creator)
- score: technical, intelligence, personality, speed (1-5)
- comments (optional)
- createdAt

### ShirtSet

Represents a reusable shirt inventory owned by a group.

Attributes:
- id
- groupId
- sponsor
- color
- shirts[]
- active (soft-delete flag)
- createdAt, updatedAt

### User

Represents an authenticated account.

Attributes:
- id
- email
- password (hashed)
- firstName, lastName (optional)
- createdAt, updatedAt

### PasswordReset

Represents password reset workflow state.

Attributes:
- id
- email
- resetToken
- expiresAt
- used
- createdAt, updatedAt

## Value Objects

### Period
- id
- name
- startDate
- endDate

Embedded in Group.

### Shirt
- number
- size
- isGoalkeeper

Embedded in ShirtSet.

### ShirtAssignment
- playerId
- shirtNumber

Embedded in Team.

## Relationships

Cardinalities (within same group unless noted):

- Group 1 -> N Members
- Group 1 -> N Events
- Group 1 -> N ShirtSets
- Group 1 -> N Periods (embedded)
- Event 1 -> N Teams (embedded)
- Event 1 -> N Invitations (embedded)
- Player 1 -> N Evaluations (embedded)
- Guardian Member N <-> N Player Member through GuardianChildLink

Cross-entity references (by ID):
- Team.selectedPlayers[] -> Member with roles[] containing player
- Team.trainerId -> Member with roles[] containing trainer, admin, or guardian when assigned as team trainer
- Team.shirtSetId -> ShirtSet
- Invitation.playerId -> Member with roles[] containing player
- GuardianChildLink.guardianMemberId -> Member with roles[] containing guardian
- GuardianChildLink.childMemberId -> Member with roles[] containing player

## Key Invariants

- All operational entities are group-scoped.
- No reference may point to an entity of another group.
- Group must retain at least one admin-capable member (business rule from permission model).
- Player.level is in range 1..5.
- Team.strength is in range 1..3.
- Invitation.status is one of the defined status values.
- Guardian-child linkage canonical source is GuardianChildLink.
- Player.guardians in API responses is a derived compatibility projection.

## Persistence Mapping (MongoDB)

Collections:
- groups
- members
- guardian-child-links
- events
- shirt-sets
- users
- password-resets

Embedding strategy:
- Keep tightly coupled structures embedded for locality and atomic updates:
  - Group.periods
  - Event.teams
  - Event.invitations
  - Player.evaluations

Reference strategy:
- Use IDs for cross-aggregate navigation and high-cardinality relations:
  - guardian-child-links for guardian/player association
  - team selected players, trainer, shirt set references

## Permission-Relevant Domain Notes

- Authorization uses roles[] on group members.
- Assigned trainer behavior depends on Team.trainerId.
- Guardian behavior depends on GuardianChildLink and projected child-centric views.

Detailed access control matrix is defined in specs/permission-model.md.

## Compatibility Notes

- Existing clients expect Player.guardians in responses.
- Current domain model keeps GuardianChildLink as canonical and derives Player.guardians for compatibility.
- This allows future guardian login and multi-role members without breaking existing API consumers.

## Open Questions

- Whether to persist additional metadata on GuardianChildLink (for example relation type, primary contact flag).
- Whether to expose member role-profile endpoints in the OpenAPI contract later.
- Whether player self-login should reuse guardian view constraints or diverge.
