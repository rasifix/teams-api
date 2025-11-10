import { mongoConnection } from '../database/connection';

export interface SequenceDocument {
  _id: string;
  sequence_value: number;
}

/**
 * Get the next sequence number for a given collection and return it as a string
 * Implements MongoDB auto-increment pattern as described in:
 * https://www.mongodb.com/resources/products/platform/mongodb-auto-increment
 */
export async function getNextSequence(sequenceName: string): Promise<string> {
  const db = mongoConnection.getDb();
  const sequencesCollection = db.collection<SequenceDocument>('sequences');
  
  const result = await sequencesCollection.findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { sequence_value: 1 } },
    {
      upsert: true,
      returnDocument: 'after'
    }
  );

  if (!result) {
    throw new Error(`Failed to generate sequence for ${sequenceName}`);
  }

  return result.sequence_value.toString();
}

/**
 * Initialize sequence counters for all collections
 * This ensures we start with proper sequence values
 */
export async function initializeSequences(): Promise<void> {
  const collections = ['groups', 'members', 'events', 'shirtsets', 'invitations', 'teams'];
  const db = mongoConnection.getDb();
  const sequencesCollection = db.collection<SequenceDocument>('sequences');
  
  for (const collection of collections) {
    const existing = await sequencesCollection.findOne({ _id: collection });
    if (!existing) {
      await sequencesCollection.insertOne({ _id: collection, sequence_value: 0 });
      console.log(`📊 Initialized sequence for: ${collection}`);
    }
  }
}