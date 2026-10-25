# Teams API

Express.js + TypeScript backend for the My Teams application.

## Getting Started

### Prerequisites
- Node.js 18+ 
- MongoDB 4.4+ (local installation or cloud instance)

### Installation
```bash
npm install
```

### Environment Configuration
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Configure your MongoDB connection in `.env`:
   ```bash
   # For local development
   MONGODB_HOST=localhost
   MONGODB_PORT=27017
   MONGODB_DATABASE=teams-dev
   
   # For production or cloud MongoDB
   MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net/teams
   ```

### Database Setup

#### Option 1: Local MongoDB Installation
Install MongoDB locally and the API will automatically:
- Connect to MongoDB on startup
- Create required collections (`people`, `events`, `shirt-sets`)
- Create optimized indexes for performance

#### Option 2: Docker Compose (Recommended for Development)
Start MongoDB using Docker Compose:

```bash
# Start MongoDB container
docker-compose up -d

# Check if MongoDB is running
docker-compose ps
```

This will:
- Start a MongoDB 7.0 container on port 27017
- Create a `teams` database with a user `teamsapi/teamsapi123`
- Persist data in a Docker volume
- Set up proper networking

Configure your `.env` file for Docker Compose (the `mongo-init` script creates
this application user on the first volume initialization):
```bash
MONGODB_HOST=localhost
MONGODB_PORT=27017
MONGODB_DATABASE=teams
MONGODB_USERNAME=teamsapi
MONGODB_PASSWORD=teamsapi123
```

Stop the container:
```bash
docker-compose down
```

Remove data volume (if you want to start fresh):
```bash
docker-compose down -v
```

### Development
```bash
npm run dev
```
This will start the server on http://localhost:3000 with hot reload enabled.

### Activity event sourcing

Event-first Activity writes are disabled by default. Before enabling them,
run the baseline migration against a paused-write environment:

```bash
npm run migrate:activity-events
```

Review the migration counts and ensure `mismatches` is empty. Then set the
feature flag in `.env` and restart the API:

```dotenv
ACTIVITY_EVENT_SOURCING_ENABLED=true
```

The `/health` response and startup banner show whether the flag is enabled.
Keep the flag disabled until the backup restore drill and canary checks in
`docs/event-sourcing-rollout.md` have passed.

### Build
```bash
npm run build
```

### Production
```bash
npm start
```

## API Endpoints

### Members
* `GET /api/members` - Get all members (players and trainers)
* `GET /api/members/:id` - Get a member by ID
* `POST /api/members` - Create a new member (player or trainer)
* `PUT /api/members/:id` - Update an existing member
* `DELETE /api/members/:id` - Delete a member

### Health Check
* `GET /health` - Check if the API and database are running

## Database Schema

The API uses MongoDB with three collections:

### Collections
- `members` - Unified collection for players and trainers
- `events` - Events with embedded teams and invitations  
- `shirt-sets` - Shirt sets with embedded shirts

### Environment Variables
| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `MONGODB_URL` | Full MongoDB connection string | - | `mongodb+srv://user:pass@cluster.net/db` |
| `MONGODB_HOST` | MongoDB host | `localhost` | `localhost` |
| `MONGODB_PORT` | MongoDB port | `27017` | `27017` |
| `MONGODB_DATABASE` | Database name | `teams` | `teams-dev` |
| `MONGODB_USERNAME` | Username for authentication | - | `teams-user` |
| `MONGODB_PASSWORD` | Password for authentication | - | `secure-password` |
| `PORT` | API server port | `3000` | `8080` |
| `ACTIVITY_EVENT_SOURCING_ENABLED` | Enable event-first Activity writes after migration | `false` | `true` |

## Data Models

### Player
```json
{
  "id": "string",
  "firstName": "string",
  "lastName": "string",
  "birthDate": "string (ISO date)",
  "level": "number (1-5)"
}
```

### Event
```json
{
  "id": "string",
  "name": "string",
  "date": "string (ISO date)",
  "startTime": "string",
  "maxPlayersPerTeam": "number",
  "teams": [Team],
  "invitations": [Invitation]
}
```

### Team
```json
{
  "id": "string",
  "name": "string",
  "strength": "number (1-5)",
  "meetingTime": "string (HH:MM)",
  "meetingLocation": "string",
  "selectedPlayers": ["string (player IDs)"]
}
```

### Invitation
```json
{
  "id": "string",
  "playerId": "string",
  "status": "open | accepted | declined"
}
```

## Technology Stack
- Express.js - Web framework
- TypeScript - Type safety
- MongoDB - Document database
- tsx - TypeScript execution and hot reload
- dotenv - Environment variable management
