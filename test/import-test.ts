import { importLocalStorageData } from '../src/controllers/importController';

// Example localStorage data structure (as it would come from teams-app)
const exampleLocalStorageData = {
  players: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      firstName: "John",
      lastName: "Doe",
      birthYear: 2010,
      level: 3
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440001", 
      firstName: "Jane",
      lastName: "Smith", 
      birthYear: 2011,
      level: 4
    }
  ],
  trainers: [
    {
      id: "trainer-uuid-1",
      firstName: "Coach",
      lastName: "Wilson"
    }
  ],
  events: [
    {
      id: "event-uuid-1",
      name: "Training Match",
      date: "2025-01-15",
      maxPlayersPerTeam: 5,
      teams: [
        {
          id: "team-uuid-1",
          name: "Team Red",
          strength: 2,
          startTime: "09:00",
          selectedPlayers: ["550e8400-e29b-41d4-a716-446655440000"],
          trainerId: "trainer-uuid-1",
          shirtAssignments: [
            {
              playerId: "550e8400-e29b-41d4-a716-446655440000",
              shirtNumber: 1
            }
          ]
        },
        {
          id: "team-uuid-2", 
          name: "Team Blue",
          strength: 2,
          startTime: "09:00",
          selectedPlayers: ["550e8400-e29b-41d4-a716-446655440001"]
        }
      ],
      invitations: [
        {
          id: "invitation-uuid-1",
          playerId: "550e8400-e29b-41d4-a716-446655440000",
          status: "accepted"
        },
        {
          id: "invitation-uuid-2", 
          playerId: "550e8400-e29b-41d4-a716-446655440001",
          status: "accepted"
        }
      ]
    }
  ],
  shirtSets: [
    {
      id: "shirtset-uuid-1",
      sponsor: "Nike",
      color: "Red", 
      shirts: [
        {
          number: 1,
          size: "M",
          isGoalkeeper: false
        },
        {
          number: 2,
          size: "L", 
          isGoalkeeper: false
        }
      ]
    }
  ]
};

/**
 * Example test function showing how the import would be called
 * This demonstrates the data transformation that happens:
 * 
 * Before Import (localStorage UUIDs):
 * - Player ID: "550e8400-e29b-41d4-a716-446655440000"
 * - Trainer ID: "trainer-uuid-1" 
 * - Event ID: "event-uuid-1"
 * 
 * After Import (Sequential IDs):
 * - Player ID: "1"
 * - Trainer ID: "2"
 * - Event ID: "1"
 * 
 * All relationships are maintained through ID mapping.
 */
async function testImportExample() {
  console.log('=== localStorage Import Example ===\n');
  
  console.log('Original localStorage data structure:');
  console.log(JSON.stringify(exampleLocalStorageData, null, 2));
  
  console.log('\n=== Import Process ===');
  console.log('1. Players imported with new sequential IDs');
  console.log('2. Trainers imported with new sequential IDs');  
  console.log('3. Shirt sets imported with new sequential IDs');
  console.log('4. Events imported with ID mapping applied');
  
  console.log('\n=== Expected Result ===');
  console.log('- 2 players imported (IDs: "1", "2")');
  console.log('- 1 trainer imported (ID: "3")');
  console.log('- 1 shirt set imported (ID: "1")'); 
  console.log('- 1 event imported (ID: "1")');
  console.log('- All team and invitation references updated to new IDs');
  
  console.log('\n=== API Usage ===');
  console.log('POST /api/groups/1/import');
  console.log('Content-Type: application/json');
  console.log('Body:', JSON.stringify(exampleLocalStorageData, null, 2));
}

// This test can be run when connected to a database
// testImportExample();

export default testImportExample;
export { exampleLocalStorageData };