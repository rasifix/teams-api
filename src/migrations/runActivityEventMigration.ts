import 'dotenv/config';
import { migrateActivityProjections } from './activityEventMigration';
import { mongoConnection } from '../database/connection';

const run = async (): Promise<void> => {
  await mongoConnection.connect();
  try {
    const result = await migrateActivityProjections();
    console.log(JSON.stringify(result, null, 2));
    if (result.mismatches.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await mongoConnection.disconnect();
  }
};

void run().catch(error => {
  console.error('Activity event migration failed:', error);
  process.exitCode = 1;
});
