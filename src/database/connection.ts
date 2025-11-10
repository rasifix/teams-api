import { MongoClient, Db, Collection } from 'mongodb';
import { 
  GroupDocument,
  PersonDocument, 
  EventDocument, 
  ShirtSetDocument,
  COLLECTIONS 
} from '../types/mongodb';
import { initializeSequences } from '../utils/sequence';

// MongoDB connection configuration from environment variables
interface MongoConfig {
  url: string;
  dbName: string;
  options: {
    maxPoolSize?: number;
    minPoolSize?: number;
    maxIdleTimeMS?: number;
    serverSelectionTimeoutMS?: number;
    socketTimeoutMS?: number;
    family?: number;
  };
}

class DatabaseConnection {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private config: MongoConfig;

  constructor() {
    this.config = this.getConfig();
  }

  private getConfig(): MongoConfig {
    const {
      MONGODB_URL,
      MONGODB_USERNAME,
      MONGODB_PASSWORD,
      MONGODB_HOST = 'localhost',
      MONGODB_PORT = '27017',
      MONGODB_DATABASE = 'teams',
      MONGODB_MAX_POOL_SIZE = '10',
      MONGODB_MIN_POOL_SIZE = '1',
      MONGODB_SERVER_SELECTION_TIMEOUT = '5000',
      MONGODB_SOCKET_TIMEOUT = '45000'
    } = process.env;

    let url: string;
    
    if (MONGODB_URL) {
      // Use provided connection string
      url = MONGODB_URL;
    } else if (MONGODB_USERNAME && MONGODB_PASSWORD) {
      // Build connection string with credentials
      url = `mongodb://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}`;
    } else {
      // Build connection string without credentials (local development)
      url = `mongodb://${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}`;
    }

    return {
      url,
      dbName: MONGODB_DATABASE,
      options: {
        maxPoolSize: parseInt(MONGODB_MAX_POOL_SIZE, 10),
        minPoolSize: parseInt(MONGODB_MIN_POOL_SIZE, 10),
        serverSelectionTimeoutMS: parseInt(MONGODB_SERVER_SELECTION_TIMEOUT, 10),
        socketTimeoutMS: parseInt(MONGODB_SOCKET_TIMEOUT, 10),
        family: 4 // Use IPv4, skip trying IPv6
      }
    };
  }

  async connect(): Promise<void> {
    try {
      console.log('Connecting to MongoDB...');
      console.log(`Database: ${this.config.dbName}`);
      console.log(`Host: ${this.config.url.replace(/\/\/[^@]*@/, '//**:**@')}`); // Hide credentials in logs
      
      this.client = new MongoClient(this.config.url, this.config.options);
      await this.client.connect();
      this.db = this.client.db(this.config.dbName);
      
      // Test the connection
      await this.db.admin().ping();
      console.log('✅ MongoDB connected successfully');
      
      // Initialize database (create collections and indexes)
      await this.initializeDatabase();
      
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      console.log('📴 MongoDB disconnected');
    }
  }

  getDb(): Db {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  // Get typed collections
  getGroupsCollection(): Collection<GroupDocument> {
    return this.getDb().collection<GroupDocument>(COLLECTIONS.GROUPS);
  }

  getMembersCollection(): Collection<PersonDocument> {
    return this.getDb().collection<PersonDocument>(COLLECTIONS.MEMBERS);
  }

  getEventsCollection(): Collection<EventDocument> {
    return this.getDb().collection<EventDocument>(COLLECTIONS.EVENTS);
  }

  getShirtSetsCollection(): Collection<ShirtSetDocument> {
    return this.getDb().collection<ShirtSetDocument>(COLLECTIONS.SHIRT_SETS);
  }

  private async initializeDatabase(): Promise<void> {
    try {
      console.log('🔧 Initializing database...');
      
      const db = this.getDb();
      
      // Create collections if they don't exist
      const existingCollections = await db.listCollections().toArray();
      const existingNames = existingCollections.map(col => col.name);

      for (const collectionName of Object.values(COLLECTIONS)) {
        if (!existingNames.includes(collectionName)) {
          await db.createCollection(collectionName);
          console.log(`📁 Created collection: ${collectionName}`);
        }
      }

      // Create indexes for optimal query performance
      await this.createIndexes();
      
      // Initialize sequence counters
      await initializeSequences();
      
      console.log('✅ Database initialization completed');
      
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  private async createIndexes(): Promise<void> {
    console.log('🔍 Creating database indexes...');
    
    // Groups collection indexes
    const groupsCollection = this.getGroupsCollection();
    await groupsCollection.createIndex({ name: 1 }); // Group name lookup
    await groupsCollection.createIndex({ createdAt: -1 }); // Recent groups first
    
    // Members collection indexes
    const membersCollection = this.getMembersCollection();
    await membersCollection.createIndex({ groupId: 1 }); // Group membership lookup
    await membersCollection.createIndex({ role: 1 });
    await membersCollection.createIndex({ firstName: 1, lastName: 1 });
    await membersCollection.createIndex({ role: 1, birthYear: 1 }); // For player queries
    await membersCollection.createIndex({ role: 1, level: 1 }); // For player queries
    await membersCollection.createIndex({ createdAt: -1 });

    // Events collection indexes
    const eventsCollection = this.getEventsCollection();
    await eventsCollection.createIndex({ groupId: 1 }); // Group events lookup
    await eventsCollection.createIndex({ eventDate: -1 }); // Recent events first
    await eventsCollection.createIndex({ 'teams.selectedPlayers': 1 }); // Player participation
    await eventsCollection.createIndex({ 'invitations.playerId': 1 }); // Invitation lookups
    await eventsCollection.createIndex({ 'teams.trainerId': 1 }); // Trainer assignments
    await eventsCollection.createIndex({ 'teams.shirtSetId': 1 }); // Shirt set assignments
    await eventsCollection.createIndex({ name: 'text' }); // Text search on event names

    // Shirt Sets collection indexes
    const shirtSetsCollection = this.getShirtSetsCollection();
    await shirtSetsCollection.createIndex({ groupId: 1 }); // Group shirt sets lookup
    await shirtSetsCollection.createIndex({ sponsor: 1, color: 1 });
    await shirtSetsCollection.createIndex({ active: 1 });
    await shirtSetsCollection.createIndex({ createdAt: -1 });

    console.log('✅ Database indexes created');
  }

  // Health check method
  async healthCheck(): Promise<{ status: string; database: string; collections: number }> {
    try {
      const db = this.getDb();
      await db.admin().ping();
      const collections = await db.listCollections().toArray();
      
      return {
        status: 'healthy',
        database: this.config.dbName,
        collections: collections.length
      };
    } catch (error) {
      throw new Error(`Database health check failed: ${error}`);
    }
  }
}

// Singleton instance
export const mongoConnection = new DatabaseConnection();

// Graceful shutdown handler
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, closing MongoDB connection...');
  await mongoConnection.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, closing MongoDB connection...');
  await mongoConnection.disconnect();
  process.exit(0);
});