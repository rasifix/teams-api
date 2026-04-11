import { mongoConnection } from '../database/connection';
import { Player, Event, Trainer, ShirtSet, Group, User, PasswordReset, PlayerEvaluation, Period, GroupRole, Guardian } from '../types';
import { 
  GroupDocument,
  PersonDocument, 
  GuardianChildLinkDocument,
  EventDocument, 
  ShirtSetDocument,
  UserDocument,
  PasswordResetDocument
} from '../types/mongodb';
import { getNextSequence } from '../utils/sequence';
import {
  groupDocumentToGroup,
  groupToGroupDocument,
  embeddedPeriodToPeriod,
  personDocumentToPlayer,
  personDocumentToTrainer,
  playerToPersonDocument,
  trainerToPersonDocument,
  eventDocumentToEvent,
  eventToEventDocument,
  shirtSetDocumentToShirtSet,
  shirtSetToShirtSetDocument
} from '../types/mappers';

// MongoDB-based data store
class DataStore {
  private resolveRoles(person: Pick<PersonDocument, 'roles'>): GroupRole[] {
    if (Array.isArray(person.roles) && person.roles.length > 0) {
      return person.roles;
    }

    return [];
  }

  private toGuardianMember(person: Pick<PersonDocument, '_id' | 'groupId' | 'firstName' | 'lastName' | 'email' | 'roles'>): Guardian {
    const roles = this.resolveRoles(person);
    return {
      id: person._id,
      groupId: person.groupId,
      roles: roles.length > 0 ? roles : ['guardian'],
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email
    };
  }

  private async getGuardiansByPlayerIds(groupId: string, playerIds: string[]): Promise<Map<string, Guardian[]>> {
    const result = new Map<string, Guardian[]>();
    for (const playerId of playerIds) {
      result.set(playerId, []);
    }

    if (playerIds.length === 0) {
      return result;
    }

    const guardianLinksCollection = mongoConnection.getGuardianChildLinksCollection();
    const membersCollection = mongoConnection.getMembersCollection();

    const linkDocs = await guardianLinksCollection.find({
      groupId,
      childMemberId: { $in: playerIds }
    }).toArray();

    if (linkDocs.length === 0) {
      return result;
    }

    const guardianMemberIds = [...new Set(linkDocs.map(link => link.guardianMemberId))];
    const guardianMemberDocs = await membersCollection.find({
      _id: { $in: guardianMemberIds },
      groupId,
      roles: { $in: ['guardian', 'trainer', 'admin'] }
    }).toArray();

    const guardianById = new Map<string, Guardian>(
      guardianMemberDocs.map(doc => [doc._id, this.toGuardianMember(doc)])
    );

    for (const link of linkDocs) {
      const guardian = guardianById.get(link.guardianMemberId);
      if (!guardian) {
        continue;
      }

      const guardians = result.get(link.childMemberId) ?? [];
      guardians.push(guardian);
      result.set(link.childMemberId, guardians);
    }

    return result;
  }

  private async populateGuardiansForPlayers(players: Player[]): Promise<Player[]> {
    if (players.length === 0) {
      return players;
    }

    const playersByGroup = new Map<string, Player[]>();
    for (const player of players) {
      const existing = playersByGroup.get(player.groupId) ?? [];
      existing.push(player);
      playersByGroup.set(player.groupId, existing);
    }

    const guardianMapByPlayerKey = new Map<string, Guardian[]>();
    for (const [groupId, groupPlayers] of playersByGroup.entries()) {
      const guardiansByPlayer = await this.getGuardiansByPlayerIds(groupId, groupPlayers.map(player => player.id));
      for (const groupPlayer of groupPlayers) {
        const key = `${groupId}:${groupPlayer.id}`;
        guardianMapByPlayerKey.set(key, guardiansByPlayer.get(groupPlayer.id) ?? []);
      }
    }

    return players.map(player => {
      const key = `${player.groupId}:${player.id}`;
      const guardians = guardianMapByPlayerKey.get(key) ?? [];
      return {
        ...player,
        guardians: guardians.length > 0 ? guardians : undefined
      };
    });
  }

  async getGroupAdminCount(groupId: string): Promise<number> {
    const membersCollection = mongoConnection.getMembersCollection();
    return membersCollection.countDocuments({ groupId, roles: 'admin' });
  }

  async getUserGroupAccess(userId: string, groupId: string): Promise<{ memberId: string; roles: GroupRole[] } | null> {
    const user = await this.getUserById(userId);
    if (!user) {
      return null;
    }

    const membersCollection = mongoConnection.getMembersCollection();
    const trainerDoc = await membersCollection.findOne({
      groupId,
      roles: { $in: ['admin', 'trainer', 'guardian'] },
      email: user.email.toLowerCase()
    });

    if (!trainerDoc) {
      return null;
    }

    const roles = this.resolveRoles(trainerDoc);
    if (!trainerDoc.roles || trainerDoc.roles.length === 0) {
      await membersCollection.updateOne(
        { _id: trainerDoc._id },
        { $set: { roles, updatedAt: new Date() } }
      );
    }

    return {
      memberId: trainerDoc._id,
      roles
    };
  }

  // Group operations
  async getAllGroups(): Promise<Group[]> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const groupDocs = await groupsCollection.find({}).sort({ createdAt: -1 }).toArray();
    return groupDocs.map(groupDocumentToGroup);
  }

  async getGroupById(id: string): Promise<Group | undefined> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const groupDoc = await groupsCollection.findOne({ _id: id });
    return groupDoc ? groupDocumentToGroup(groupDoc) : undefined;
  }

  async createGroup(group: Group): Promise<Group> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const groupDoc = groupToGroupDocument(group);
    const now = new Date();

    const newDoc: GroupDocument = {
      _id: group.id,
      ...groupDoc,
      createdAt: now,
      updatedAt: now
    };

    await groupsCollection.insertOne(newDoc);
    return group;
  }

  async updateGroup(id: string, updates: Partial<Pick<Group, 'name' | 'club'>>): Promise<Group | null> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const updateDoc = {
      ...updates,
      updatedAt: new Date()
    };

    const result = await groupsCollection.findOneAndUpdate(
      { _id: id },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    return result ? groupDocumentToGroup(result) : null;
  }

  async deleteGroup(id: string): Promise<boolean> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const result = await groupsCollection.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  async getGroupPeriods(groupId: string): Promise<Period[] | null> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const groupDoc = await groupsCollection.findOne(
      { _id: groupId },
      { projection: { periods: 1 } }
    );

    if (!groupDoc) {
      return null;
    }

    return (groupDoc.periods ?? []).map(embeddedPeriodToPeriod);
  }

  async addPeriodToGroup(groupId: string, period: Period): Promise<Period | null> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const { periodToEmbedded } = await import('../types/mappers');
    const embeddedPeriod = periodToEmbedded(period);

    const result = await groupsCollection.findOneAndUpdate(
      { _id: groupId },
      {
        $push: { periods: embeddedPeriod },
        $set: { updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return null;
    }

    const createdPeriod = result.periods?.find(existingPeriod => existingPeriod.id === period.id);
    return createdPeriod ? embeddedPeriodToPeriod(createdPeriod) : null;
  }

  async updatePeriodInGroup(groupId: string, periodId: string, updates: Partial<Omit<Period, 'id'>>): Promise<Period | null> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const updateDoc: Record<string, string | Date> = {
      updatedAt: new Date()
    };

    if (updates.name !== undefined) updateDoc['periods.$.name'] = updates.name;
    if (updates.startDate !== undefined) updateDoc['periods.$.startDate'] = updates.startDate;
    if (updates.endDate !== undefined) updateDoc['periods.$.endDate'] = updates.endDate;

    const result = await groupsCollection.findOneAndUpdate(
      { _id: groupId, 'periods.id': periodId },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      return null;
    }

    const updatedPeriod = result.periods?.find(existingPeriod => existingPeriod.id === periodId);
    return updatedPeriod ? embeddedPeriodToPeriod(updatedPeriod) : null;
  }

  async deletePeriodFromGroup(groupId: string, periodId: string): Promise<boolean> {
    const groupsCollection = mongoConnection.getGroupsCollection();
    const result = await groupsCollection.updateOne(
      { _id: groupId },
      {
        $pull: { periods: { id: periodId } },
        $set: { updatedAt: new Date() }
      }
    );

    return result.modifiedCount > 0;
  }

  // Player operations (now scoped to groups)
  async getAllPlayers(groupId?: string): Promise<Player[]> {
    const membersCollection = mongoConnection.getMembersCollection();
    const filter: any = { roles: 'player' };
    if (groupId) {
      filter.groupId = groupId;
    }
    const playerDocs = await membersCollection.find(filter).toArray();
    const players = playerDocs
      .map(personDocumentToPlayer)
      .filter((player): player is Player => player !== null);

    return this.populateGuardiansForPlayers(players);
  }

  async getPlayerById(id: string): Promise<Player | undefined> {
    const membersCollection = mongoConnection.getMembersCollection();
    const playerDoc = await membersCollection.findOne({ 
      _id: id, 
      roles: 'player'
    });
    
    const player = playerDoc ? personDocumentToPlayer(playerDoc) || undefined : undefined;
    if (!player) {
      return undefined;
    }

    const [populatedPlayer] = await this.populateGuardiansForPlayers([player]);
    return populatedPlayer;
  }

  async createPlayer(player: Player): Promise<Player> {
    const membersCollection = mongoConnection.getMembersCollection();
    const personDoc = playerToPersonDocument(player);
    const now = new Date();
    
    const newDoc: PersonDocument = {
      _id: player.id,
      ...personDoc,
      createdAt: now,
      updatedAt: now
    };
    
    await membersCollection.insertOne(newDoc);
    return player;
  }

  async updatePlayer(id: string, updates: Partial<Omit<Player, 'id'>>): Promise<Player | null> {
    const membersCollection = mongoConnection.getMembersCollection();
    // Filter out evaluations and guardians from updates since they are managed separately
    const { evaluations, guardians, ...safeUpdates } = updates;
    const updateDoc = {
      ...safeUpdates,
      updatedAt: new Date()
    };
    
    const result = await membersCollection.findOneAndUpdate(
      { _id: id, roles: 'player' },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return null;
    }

    const player = personDocumentToPlayer(result);
    if (!player) {
      return null;
    }

    const [populatedPlayer] = await this.populateGuardiansForPlayers([player]);
    return populatedPlayer;
  }

  async addEvaluationToPlayer(playerId: string, evaluation: PlayerEvaluation): Promise<Player | null> {
    const membersCollection = mongoConnection.getMembersCollection();
    const { playerEvaluationToEmbedded } = await import('../types/mappers');
    const embeddedEvaluation = playerEvaluationToEmbedded(evaluation);
    
    const result = await membersCollection.findOneAndUpdate(
      { _id: playerId, roles: 'player' },
      { 
        $push: { evaluations: embeddedEvaluation },
        $set: { updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return null;
    }

    const player = personDocumentToPlayer(result);
    if (!player) {
      return null;
    }

    const [populatedPlayer] = await this.populateGuardiansForPlayers([player]);
    return populatedPlayer;
  }

  async updateEvaluationForPlayer(playerId: string, evaluationId: string, evaluation: PlayerEvaluation): Promise<Player | null> {
    const membersCollection = mongoConnection.getMembersCollection();
    const { playerEvaluationToEmbedded } = await import('../types/mappers');
    const embeddedEvaluation = playerEvaluationToEmbedded(evaluation);
    
    const result = await membersCollection.findOneAndUpdate(
      { _id: playerId, roles: 'player', 'evaluations.id': evaluationId },
      { 
        $set: { 
          'evaluations.$': embeddedEvaluation,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return null;
    }

    const player = personDocumentToPlayer(result);
    if (!player) {
      return null;
    }

    const [populatedPlayer] = await this.populateGuardiansForPlayers([player]);
    return populatedPlayer;
  }

  async deleteEvaluationFromPlayer(playerId: string, evaluationId: string): Promise<boolean> {
    const membersCollection = mongoConnection.getMembersCollection();
    
    const result = await membersCollection.updateOne(
      { _id: playerId, roles: 'player' },
      { 
        $pull: { evaluations: { id: evaluationId } },
        $set: { updatedAt: new Date() }
      }
    );
    
    return result.modifiedCount > 0;
  }

  async deletePlayer(id: string): Promise<boolean> {
    const membersCollection = mongoConnection.getMembersCollection();
    const guardianLinksCollection = mongoConnection.getGuardianChildLinksCollection();
    const result = await membersCollection.deleteOne({ 
      _id: id, 
      roles: 'player'
    });

    if (result.deletedCount > 0) {
      await guardianLinksCollection.deleteMany({ childMemberId: id });
    }
    
    return result.deletedCount > 0;
  }

  // Event operations
  async getAllEvents(groupId?: string): Promise<Event[]> {
    const eventsCollection = mongoConnection.getEventsCollection();
    const filter = groupId ? { groupId } : {};
    const eventDocs = await eventsCollection.find(filter).sort({ eventDate: -1 }).toArray();
    return eventDocs.map(eventDocumentToEvent);
  }

  async getEventById(id: string): Promise<Event | undefined> {
    const eventsCollection = mongoConnection.getEventsCollection();
    const eventDoc = await eventsCollection.findOne({ _id: id });
    
    return eventDoc ? eventDocumentToEvent(eventDoc) : undefined;
  }

  async createEvent(event: Event): Promise<Event> {
    const eventsCollection = mongoConnection.getEventsCollection();
    const eventDoc = eventToEventDocument(event);
    const now = new Date();
    
    const newDoc: EventDocument = {
      _id: event.id,
      ...eventDoc,
      createdAt: now,
      updatedAt: now
    };
    
    await eventsCollection.insertOne(newDoc);
    return event;
  }

  async updateEvent(id: string, updates: Partial<Omit<Event, 'id'>>): Promise<Event | null> {
    const eventsCollection = mongoConnection.getEventsCollection();
    
    // Convert updates to MongoDB format
    const updateDoc: any = { updatedAt: new Date() };
    
    if (updates.name !== undefined) updateDoc.name = updates.name;
    if (updates.date !== undefined) updateDoc.eventDate = new Date(updates.date);
    if (updates.maxPlayersPerTeam !== undefined) updateDoc.maxPlayersPerTeam = updates.maxPlayersPerTeam;
    if (updates.minPlayersPerTeam !== undefined) updateDoc.minPlayersPerTeam = updates.minPlayersPerTeam;
    if (updates.location !== undefined) updateDoc.location = updates.location;
    if (updates.teams !== undefined) {
      const { teamToEmbedded } = await import('../types/mappers');
      updateDoc.teams = updates.teams.map(teamToEmbedded);
    }
    if (updates.invitations !== undefined) {
      const { invitationToEmbedded } = await import('../types/mappers');
      updateDoc.invitations = updates.invitations.map(invitationToEmbedded);
    }
    
    const result = await eventsCollection.findOneAndUpdate(
      { _id: id },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );
    
    return result ? eventDocumentToEvent(result) : null;
  }

  async deleteEvent(id: string): Promise<boolean> {
    const eventsCollection = mongoConnection.getEventsCollection();
    const result = await eventsCollection.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  // Trainer operations
  async getAllTrainers(groupId: string): Promise<Trainer[]> {
    const membersCollection = mongoConnection.getMembersCollection();
    const filter: any = { roles: { $in: ['trainer', 'admin'] } };
    if (groupId) {
      filter.groupId = groupId;
    }
    const trainerDocs = await membersCollection.find(filter).toArray();
    return trainerDocs
      .map(personDocumentToTrainer)
      .filter((trainer): trainer is Trainer => trainer !== null);
  }

  async getTrainerById(id: string): Promise<Trainer | undefined> {
    const membersCollection = mongoConnection.getMembersCollection();
    const trainerDoc = await membersCollection.findOne({ 
      _id: id, 
      roles: { $in: ['trainer', 'admin', 'guardian'] }
    });
    
    if (!trainerDoc) return undefined;
    
    const trainer = personDocumentToTrainer(trainerDoc);
    if (!trainer) return undefined;
        
    return trainer;
  }

  async createTrainer(trainer: Trainer): Promise<Trainer> {
    const membersCollection = mongoConnection.getMembersCollection();
    const roles: GroupRole[] = trainer.roles && trainer.roles.length > 0
      ? trainer.roles
      : ['trainer'];
    const personDoc = trainerToPersonDocument({ ...trainer, roles });
    const now = new Date();
    
    const newDoc: PersonDocument = {
      _id: trainer.id,
      ...personDoc,
      createdAt: now,
      updatedAt: now
    };
    
    await membersCollection.insertOne(newDoc);
    return trainer;
  }

  async updateTrainer(id: string, updates: Partial<Omit<Trainer, 'id'>>): Promise<Trainer | null> {
    const membersCollection = mongoConnection.getMembersCollection();
    const updateDoc = {
      ...updates,
      updatedAt: new Date()
    };
    
    const result = await membersCollection.findOneAndUpdate(
      { _id: id, roles: { $in: ['trainer', 'admin', 'guardian'] } },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );
    
    return result ? personDocumentToTrainer(result) : null;
  }

  async deleteTrainer(id: string): Promise<{ deleted: boolean; reason?: 'not-found' | 'last-admin' }> {
    const membersCollection = mongoConnection.getMembersCollection();
    const guardianLinksCollection = mongoConnection.getGuardianChildLinksCollection();
    const trainerDoc = await membersCollection.findOne({
      _id: id,
      roles: { $in: ['trainer', 'admin', 'guardian'] }
    });

    if (!trainerDoc) {
      return { deleted: false, reason: 'not-found' };
    }

    const trainerRoles = this.resolveRoles(trainerDoc);
    if (trainerRoles.includes('admin')) {
      const adminCount = await this.getGroupAdminCount(trainerDoc.groupId);
      if (adminCount <= 1) {
        return { deleted: false, reason: 'last-admin' };
      }
    }

    const result = await membersCollection.deleteOne({ 
      _id: id, 
      roles: { $in: ['trainer', 'admin', 'guardian'] }
    });

    if (result.deletedCount === 0) {
      return { deleted: false, reason: 'not-found' };
    }

    await guardianLinksCollection.deleteMany({ guardianMemberId: id });

    return { deleted: true };
  }

  async upsertGuardianMember(groupId: string, guardian: Partial<Guardian>): Promise<Guardian> {
    const membersCollection = mongoConnection.getMembersCollection();
    const normalizedEmail = guardian.email?.toLowerCase();

    let existingGuardianMember: PersonDocument | null = null;
    if (normalizedEmail) {
      existingGuardianMember = await membersCollection.findOne({
        groupId,
        roles: { $in: ['trainer', 'admin', 'guardian'] },
        email: normalizedEmail
      });
    }

    if (existingGuardianMember) {
      const roles = new Set(existingGuardianMember.roles ?? []);
      roles.add('guardian');
      const updatedRoles = Array.from(roles) as GroupRole[];

      const updates: Partial<PersonDocument> = {
        updatedAt: new Date(),
        roles: updatedRoles
      };

      if (!existingGuardianMember.firstName && guardian.firstName) {
        updates.firstName = guardian.firstName;
      }
      if (!existingGuardianMember.lastName && guardian.lastName) {
        updates.lastName = guardian.lastName;
      }

      await membersCollection.updateOne(
        { _id: existingGuardianMember._id },
        { $set: updates }
      );

      return this.toGuardianMember({
        _id: existingGuardianMember._id,
        groupId: existingGuardianMember.groupId,
        firstName: updates.firstName ?? existingGuardianMember.firstName,
        lastName: updates.lastName ?? existingGuardianMember.lastName,
        email: existingGuardianMember.email
      });
    }

    const now = new Date();
    const guardianMemberId = await getNextSequence('members');
    const guardianMember: PersonDocument = {
      _id: guardianMemberId,
      roles: ['guardian'],
      groupId,
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      email: normalizedEmail,
      createdAt: now,
      updatedAt: now
    };

    await membersCollection.insertOne(guardianMember);
    return this.toGuardianMember(guardianMember);
  }

  async addGuardianLink(groupId: string, guardianMemberId: string, childMemberId: string): Promise<void> {
    const guardianLinksCollection = mongoConnection.getGuardianChildLinksCollection();
    const now = new Date();

    await guardianLinksCollection.updateOne(
      { groupId, guardianMemberId, childMemberId },
      {
        $setOnInsert: {
          _id: `${groupId}:${guardianMemberId}:${childMemberId}`,
          groupId,
          guardianMemberId,
          childMemberId,
          createdAt: now
        } as GuardianChildLinkDocument,
        $set: {
          updatedAt: now
        }
      },
      { upsert: true }
    );
  }

  async removeGuardianLink(groupId: string, guardianMemberId: string, childMemberId: string): Promise<boolean> {
    const guardianLinksCollection = mongoConnection.getGuardianChildLinksCollection();
    const result = await guardianLinksCollection.deleteOne({ groupId, guardianMemberId, childMemberId });
    return result.deletedCount > 0;
  }

  async getGuardianChildPlayerIds(groupId: string, guardianMemberId: string): Promise<string[]> {
    const guardianLinksCollection = mongoConnection.getGuardianChildLinksCollection();
    const links = await guardianLinksCollection.find({ groupId, guardianMemberId }).toArray();
    return links.map(link => link.childMemberId);
  }

  // Shirt Set operations
  async getAllShirtSets(groupId?: string): Promise<ShirtSet[]> {
    const shirtSetsCollection = mongoConnection.getShirtSetsCollection();
    const filter: any = { active: { $ne: false } };
    if (groupId) {
      filter.groupId = groupId;
    }
    const shirtSetDocs = await shirtSetsCollection.find(filter).toArray();
    return shirtSetDocs.map(shirtSetDocumentToShirtSet);
  }

  async getShirtSetById(id: string): Promise<ShirtSet | undefined> {
    const shirtSetsCollection = mongoConnection.getShirtSetsCollection();
    const shirtSetDoc = await shirtSetsCollection.findOne({ 
      _id: id, 
      active: { $ne: false } 
    });
    
    return shirtSetDoc ? shirtSetDocumentToShirtSet(shirtSetDoc) : undefined;
  }

  async createShirtSet(shirtSet: ShirtSet): Promise<ShirtSet> {
    const shirtSetsCollection = mongoConnection.getShirtSetsCollection();
    const shirtSetDoc = shirtSetToShirtSetDocument(shirtSet);
    const now = new Date();
    
    const newDoc: ShirtSetDocument = {
      _id: shirtSet.id,
      ...shirtSetDoc,
      createdAt: now,
      updatedAt: now
    };
    
    await shirtSetsCollection.insertOne(newDoc);
    return shirtSet;
  }

  async updateShirtSet(id: string, updates: Partial<Omit<ShirtSet, 'id'>>): Promise<ShirtSet | null> {
    const shirtSetsCollection = mongoConnection.getShirtSetsCollection();
    const updateDoc = {
      ...updates,
      updatedAt: new Date()
    };
    
    const result = await shirtSetsCollection.findOneAndUpdate(
      { _id: id, active: { $ne: false } },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );
    
    return result ? shirtSetDocumentToShirtSet(result) : null;
  }

  async deleteShirtSet(id: string): Promise<boolean> {
    const shirtSetsCollection = mongoConnection.getShirtSetsCollection();
    const result = await shirtSetsCollection.updateOne(
      { _id: id },
      { $set: { active: false, updatedAt: new Date() } }
    );
    
    return result.modifiedCount > 0;
  }

  // User operations
  async getUserByEmail(email: string): Promise<User | undefined> {
    const usersCollection = mongoConnection.getUsersCollection();
    const userDoc = await usersCollection.findOne({ email: email.toLowerCase() });
    
    if (!userDoc) return undefined;
    
    return {
      id: userDoc._id,
      email: userDoc.email,
      password: userDoc.password,
      firstName: userDoc.firstName,
      lastName: userDoc.lastName,
      createdAt: userDoc.createdAt.toISOString(),
      updatedAt: userDoc.updatedAt.toISOString()
    };
  }

  async getUserById(id: string): Promise<User | undefined> {
    const usersCollection = mongoConnection.getUsersCollection();
    const userDoc = await usersCollection.findOne({ _id: id });
    
    if (!userDoc) return undefined;
    
    return {
      id: userDoc._id,
      email: userDoc.email,
      password: userDoc.password,
      firstName: userDoc.firstName,
      lastName: userDoc.lastName,
      createdAt: userDoc.createdAt.toISOString(),
      updatedAt: userDoc.updatedAt.toISOString()
    };
  }

  async createUser(user: User): Promise<User> {
    const usersCollection = mongoConnection.getUsersCollection();
    const now = new Date();
    
    const newDoc: UserDocument = {
      _id: user.id,
      email: user.email,
      password: user.password,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: now,
      updatedAt: now
    };
    
    await usersCollection.insertOne(newDoc);
    
    return {
      id: newDoc._id,
      email: newDoc.email,
      password: newDoc.password,
      firstName: newDoc.firstName,
      lastName: newDoc.lastName,
      createdAt: newDoc.createdAt.toISOString(),
      updatedAt: newDoc.updatedAt.toISOString()
    };
  }

  // Password Reset operations
  async createPasswordReset(resetData: PasswordReset): Promise<PasswordReset> {
    const passwordResetsCollection = mongoConnection.getPasswordResetsCollection();
    const now = new Date();
    
    const newDoc: PasswordResetDocument = {
      _id: resetData.id,
      email: resetData.email,
      resetToken: resetData.resetToken,
      expiresAt: new Date(resetData.expiresAt),
      used: resetData.used,
      createdAt: now,
      updatedAt: now
    };
    
    await passwordResetsCollection.insertOne(newDoc);
    
    return {
      id: newDoc._id,
      email: newDoc.email,
      resetToken: newDoc.resetToken,
      expiresAt: newDoc.expiresAt.toISOString(),
      used: newDoc.used,
      createdAt: newDoc.createdAt.toISOString()
    };
  }

  async getPasswordResetByToken(resetToken: string, email: string): Promise<PasswordReset | undefined> {
    const passwordResetsCollection = mongoConnection.getPasswordResetsCollection();
    const resetDoc = await passwordResetsCollection.findOne({ 
      resetToken,
      email,
      used: false
    });
    
    if (!resetDoc) return undefined;
    
    return {
      id: resetDoc._id,
      email: resetDoc.email,
      resetToken: resetDoc.resetToken,
      expiresAt: resetDoc.expiresAt.toISOString(),
      used: resetDoc.used,
      createdAt: resetDoc.createdAt.toISOString()
    };
  }

  async markPasswordResetAsUsed(id: string): Promise<boolean> {
    const passwordResetsCollection = mongoConnection.getPasswordResetsCollection();
    const result = await passwordResetsCollection.updateOne(
      { _id: id },
      { $set: { used: true, updatedAt: new Date() } }
    );
    
    return result.modifiedCount > 0;
  }

  async updateUserPassword(email: string, hashedPassword: string): Promise<boolean> {
    const usersCollection = mongoConnection.getUsersCollection();
    const result = await usersCollection.updateOne(
      { email },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );
    
    return result.modifiedCount > 0;
  }
}

export const dataStore = new DataStore();