import { getNextSequence } from '../src/utils/sequence';

async function testSequences() {
  console.log('Testing MongoDB auto-increment sequences...');
  
  try {
    // Test different sequence names
    const group1 = await getNextSequence('groups');
    const group2 = await getNextSequence('groups');
    const member1 = await getNextSequence('members');
    const member2 = await getNextSequence('members');
    const event1 = await getNextSequence('events');
    
    console.log('Generated IDs:');
    console.log('Group IDs:', group1, group2);
    console.log('Member IDs:', member1, member2);
    console.log('Event ID:', event1);
    
    // Verify they are sequential strings
    console.log('Verification:');
    console.log('Groups are sequential:', parseInt(group2, 10) === parseInt(group1, 10) + 1);
    console.log('Members are sequential:', parseInt(member2, 10) === parseInt(member1, 10) + 1);
    console.log('All IDs are strings:', typeof group1 === 'string' && typeof member1 === 'string');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// This would be run if connected to a database
// testSequences();

export default testSequences;