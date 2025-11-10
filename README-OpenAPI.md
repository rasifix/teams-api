# Teams API - OpenAPI Specification

This directory contains the OpenAPI 3.0.3 specification for the Teams API.

## Files

- `openapi-spec.yaml` - Complete OpenAPI specification for the Teams API

## Overview

The Teams API provides endpoints for managing:
- **Members** (Players and Trainers) - Unified endpoint for managing both players and trainers
- **Events** - Soccer events with team management and player invitations
- **Shirt Sets** - Equipment management for team jerseys

## Key Features

### Unified Members Endpoint
Instead of separate `/players` and `/trainers` endpoints, the API uses a single `/members` endpoint with role-based filtering:

```
GET /api/members?role=player    # Get all players
GET /api/members?role=trainer   # Get all trainers
GET /api/members                # Get both players and trainers
```

### Event Management
Complete event lifecycle management:
- Create events with teams
- Invite players to events
- Track invitation responses (open/accepted/declined)
- Manage team player selection

### Equipment Tracking
Manage shirt sets with individual shirt assignments to players.

## Using the Specification

### 1. View in Swagger UI
You can view the API documentation by uploading the `openapi-spec.yaml` file to:
- [Swagger Editor](https://editor.swagger.io/)
- [Redoc](https://redocly.github.io/redoc/)

### 2. Generate Client Code
Use tools like:
- [OpenAPI Generator](https://openapi-generator.tech/)
- [Swagger Codegen](https://swagger.io/tools/swagger-codegen/)

Example:
```bash
openapi-generator-cli generate -i openapi-spec.yaml -g typescript-fetch -o ./generated-client
```

### 3. API Testing
Import the specification into:
- [Postman](https://www.postman.com/)
- [Insomnia](https://insomnia.rest/)
- [httpie](https://httpie.io/)

## Example Requests

### Create a Player
```json
POST /api/Members
{
  "role": "player",
  "firstName": "John",
  "lastName": "Doe",
  "birthYear": 2010,
  "level": 3
}
```

### Create a Trainer
```json
POST /api/Members
{
  "role": "trainer",
  "firstName": "Jane",
  "lastName": "Smith"
}
```

### Create an Event
```json
POST /api/events
{
  "name": "Saturday Practice",
  "date": "2025-11-15",
  "maxPlayersPerTeam": 11,
  "teams": [
    {
      "id": "uuid",
      "name": "Team A",
      "strength": 2,
      "startTime": "14:00",
      "selectedPlayers": []
    }
  ]
}
```

## Response Format

All successful responses follow standard HTTP status codes:
- `200` - Success (for GET, PUT operations)
- `201` - Created (for POST operations)
- `204` - No Content (for DELETE operations)

Error responses include an error object:
```json
{
  "error": "Description of the error"
}
```
