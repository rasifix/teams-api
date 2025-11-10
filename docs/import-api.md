# Import API Documentation

## Overview
The Import API allows you to import data from the teams-app localStorage format into a specific group in the API.

## Endpoint
```
POST /api/groups/:groupId/import
```

## Request Body
The request body should contain the localStorage data structure from the teams-app:

```json
{
  "players": [
    {
      "id": "uuid-or-existing-id",
      "firstName": "John",
      "lastName": "Doe",
      "birthYear": 2010,
      "level": 3
    }
  ],
  "trainers": [
    {
      "id": "uuid-or-existing-id",
      "firstName": "Jane",
      "lastName": "Smith"
    }
  ],
  "events": [
    {
      "id": "uuid-or-existing-id",
      "name": "Training Session",
      "date": "2025-01-15",
      "maxPlayersPerTeam": 10,
      "teams": [
        {
          "id": "team-uuid",
          "name": "Team A",
          "strength": 2,
          "startTime": "09:00",
          "selectedPlayers": ["player-uuid-1", "player-uuid-2"],
          "trainerId": "trainer-uuid",
          "shirtSetId": "shirtset-uuid"
        }
      ],
      "invitations": [
        {
          "id": "invitation-uuid",
          "playerId": "player-uuid-1",
          "status": "accepted"
        }
      ]
    }
  ],
  "shirtSets": [
    {
      "id": "uuid-or-existing-id",
      "sponsor": "Nike",
      "color": "Red",
      "shirts": [
        {
          "number": 1,
          "size": "M",
          "isGoalkeeper": true
        }
      ]
    }
  ]
}
```

## Response
```json
{
  "message": "Import completed",
  "summary": {
    "playersImported": 5,
    "trainersImported": 2,
    "eventsImported": 3,
    "shirtSetsImported": 2,
    "errors": []
  },
  "groupId": "1"
}
```

## Features

### ID Mapping
- The import process automatically generates new sequential IDs for all entities
- Maintains relationships between entities by mapping old UUIDs to new sequential IDs
- Example: UUID "550e8400-e29b-41d4-a716-446655440000" becomes "1"

### Import Order
1. **Players** - Imported first to establish member base
2. **Trainers** - Imported second to establish trainer base  
3. **Shirt Sets** - Imported third to establish equipment
4. **Events** - Imported last to resolve all references to players, trainers, and shirt sets

### Error Handling
- Individual entity failures don't stop the entire import
- Error details are provided in the response summary
- Partial imports are supported

### Data Validation
- Group existence is verified before import
- Required fields are validated for each entity type
- Malformed data is logged and skipped

## Example Usage

### JavaScript/Fetch
```javascript
// Get localStorage data from teams-app
const localStorageData = {
  players: JSON.parse(localStorage.getItem('players') || '[]'),
  trainers: JSON.parse(localStorage.getItem('trainers') || '[]'),
  events: JSON.parse(localStorage.getItem('events') || '[]'),
  shirtSets: JSON.parse(localStorage.getItem('shirtSets') || '[]')
};

// Import to group ID 1
const response = await fetch('/api/groups/1/import', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(localStorageData)
});

const result = await response.json();
console.log('Import result:', result);
```

### cURL
```bash
curl -X POST http://localhost:3000/api/groups/1/import \
  -H "Content-Type: application/json" \
  -d @exported-data.json
```

## Migration Workflow

1. **Export from teams-app**: Use the export functionality in teams-app to download data as JSON
2. **Create Group**: Create a new group in the API if needed: `POST /api/groups`
3. **Import Data**: Use this import endpoint to transfer data to the group
4. **Verify Import**: Check the response summary for any errors
5. **Test API**: Verify imported data through the standard API endpoints

## Notes

- This import is designed specifically for migrating from the localStorage-based teams-app
- All imported entities will be associated with the specified group
- Original UUIDs are replaced with sequential numeric IDs (as strings)
- The import process is idempotent - running it multiple times will create duplicate entries