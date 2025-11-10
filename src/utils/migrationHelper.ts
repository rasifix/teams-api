/**
 * Utility functions to help extract localStorage data from teams-app for import
 */

/**
 * This function can be run in the browser console on the teams-app
 * to extract all localStorage data in the format expected by the import API
 * Note: This function is designed to run in a browser environment with localStorage
 */
export function extractLocalStorageData(): any {
  // @ts-ignore - localStorage is only available in browser environment
  if (typeof localStorage === 'undefined') {
    throw new Error('This function must be run in a browser environment with localStorage');
  }

  const STORAGE_KEYS = {
    PLAYERS: 'players',
    EVENTS: 'events',
    SHIRT_SETS: 'shirtSets',
    TRAINERS: 'trainers',
  };

  const data: any = {};
  
  // Extract each data type from localStorage
  Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => {
    // @ts-ignore - localStorage check above
    const item = localStorage.getItem(storageKey);
    if (item) {
      try {
        data[storageKey] = JSON.parse(item);
        console.log(`✅ Extracted ${key}:`, JSON.parse(item).length, 'items');
      } catch (error) {
        console.error(`❌ Error parsing ${key}:`, error);
        data[storageKey] = [];
      }
    } else {
      data[storageKey] = [];
      console.log(`ℹ️  No data found for ${key}`);
    }
  });
  
  return data;
}

/**
 * Browser console script to extract and download localStorage data
 * Run this in the teams-app browser console:
 */
export const browserConsoleScript = `
// Extract localStorage data for import
(function() {
  const STORAGE_KEYS = {
    PLAYERS: 'players',
    EVENTS: 'events', 
    SHIRT_SETS: 'shirtSets',
    TRAINERS: 'trainers',
  };

  const data = {};
  
  Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => {
    const item = localStorage.getItem(storageKey);
    if (item) {
      try {
        data[storageKey] = JSON.parse(item);
        console.log('✅ Extracted ' + key + ':', JSON.parse(item).length + ' items');
      } catch (error) {
        console.error('❌ Error parsing ' + key + ':', error);
        data[storageKey] = [];
      }
    } else {
      data[storageKey] = [];
      console.log('ℹ️  No data found for ' + key);
    }
  });
  
  // Download as JSON file
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  link.download = 'teams-app-export-' + timestamp + '.json';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  console.log('📁 Download started: teams-app-export-' + timestamp + '.json');
  console.log('📤 Use this file with: POST /api/groups/{groupId}/import');
  
  return data;
})();
`;

/**
 * Instructions for users migrating from teams-app to teams-api
 */
export const migrationInstructions = `
=== Teams-App to Teams-API Migration Guide ===

1. EXPORT DATA FROM TEAMS-APP:
   - Open teams-app in your browser
   - Open browser developer console (F12)
   - Paste and run this script:
   
   ${browserConsoleScript}
   
   - This will download a JSON file with all your data

2. CREATE A GROUP IN TEAMS-API:
   POST /api/groups
   {
     "name": "My Team"
   }
   
   - Note the returned group ID

3. IMPORT YOUR DATA:
   POST /api/groups/{groupId}/import
   Content-Type: application/json
   
   - Upload the JSON file from step 1 as the request body
   
4. VERIFY IMPORT:
   - Check the response for import summary
   - Test API endpoints to verify data:
     GET /api/groups/{groupId}/members
     GET /api/groups/{groupId}/events
     GET /api/groups/{groupId}/shirtsets

5. UPDATE YOUR APPLICATION:
   - Update frontend to use new API endpoints
   - All IDs will be sequential numbers instead of UUIDs
   - API structure is now group-based instead of flat

=== Example Import Result ===
Before: UUID "550e8400-e29b-41d4-a716-446655440000"
After:  Sequential ID "1"

All relationships between players, events, teams, etc. are preserved
during the migration through automatic ID mapping.
`;

export default {
  extractLocalStorageData,
  browserConsoleScript, 
  migrationInstructions
};