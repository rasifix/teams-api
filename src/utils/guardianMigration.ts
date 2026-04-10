import { Collection, Db } from 'mongodb';
import { COLLECTIONS, GuardianChildLinkDocument, PersonDocument } from '../types/mongodb';

const ensureGuardianRole = async (
  membersCollection: Collection<PersonDocument>,
  memberDoc: PersonDocument
): Promise<PersonDocument> => {
  const roles = new Set(memberDoc.roles ?? []);
  roles.add('guardian');

  if (!memberDoc.roles || memberDoc.roles.length !== roles.size || !memberDoc.roles.includes('guardian')) {
    const updatedRoles = Array.from(roles) as PersonDocument['roles'];
    await membersCollection.updateOne(
      { _id: memberDoc._id },
      {
        $set: {
          roles: updatedRoles,
          updatedAt: new Date()
        }
      }
    );

    return {
      ...memberDoc,
      roles: updatedRoles
    };
  }

  return memberDoc;
};

const resolveGuardianMemberId = (playerId: string, groupId: string, embeddedGuardianId?: string, index?: number): string => {
  if (embeddedGuardianId) {
    return embeddedGuardianId;
  }

  return `${groupId}-guardian-${playerId}-${index ?? 0}`;
};

export async function migrateEmbeddedGuardiansToLinks(db: Db): Promise<void> {
  const membersCollection = db.collection<PersonDocument>(COLLECTIONS.MEMBERS);
  const guardianLinksCollection = db.collection<GuardianChildLinkDocument>(COLLECTIONS.GUARDIAN_CHILD_LINKS);

  const playersWithEmbeddedGuardians = await membersCollection.find({
    role: 'player',
    guardians: { $exists: true, $ne: [] }
  }).toArray();

  if (playersWithEmbeddedGuardians.length === 0) {
    return;
  }

  let createdGuardianMembers = 0;
  let linkedRelations = 0;
  let cleanedPlayers = 0;

  for (const playerDoc of playersWithEmbeddedGuardians) {
    const embeddedGuardians = playerDoc.guardians ?? [];

    for (let index = 0; index < embeddedGuardians.length; index += 1) {
      const embeddedGuardian = embeddedGuardians[index];
      const normalizedEmail = embeddedGuardian.email?.toLowerCase();

      let guardianMember: PersonDocument | null = null;

      if (normalizedEmail) {
        guardianMember = await membersCollection.findOne({
          groupId: playerDoc.groupId,
          role: 'trainer',
          email: normalizedEmail
        });
      }

      if (!guardianMember) {
        let guardianMemberId = resolveGuardianMemberId(playerDoc._id, playerDoc.groupId, embeddedGuardian.id, index);
        let existingById = await membersCollection.findOne({ _id: guardianMemberId });
        let attempt = 1;
        while (existingById) {
          guardianMemberId = `${resolveGuardianMemberId(playerDoc._id, playerDoc.groupId, undefined, index)}-${attempt}`;
          existingById = await membersCollection.findOne({ _id: guardianMemberId });
          attempt += 1;
        }

        const now = new Date();
        const newGuardianMember: PersonDocument = {
          _id: guardianMemberId,
          role: 'trainer',
          roles: ['guardian'],
          groupId: playerDoc.groupId,
          firstName: embeddedGuardian.firstName,
          lastName: embeddedGuardian.lastName,
          email: normalizedEmail,
          createdAt: now,
          updatedAt: now
        };

        await membersCollection.insertOne(newGuardianMember);
        createdGuardianMembers += 1;
        guardianMember = newGuardianMember;
      } else {
        guardianMember = await ensureGuardianRole(membersCollection, guardianMember);
      }

      const now = new Date();
      const linkId = `${playerDoc.groupId}:${guardianMember._id}:${playerDoc._id}`;

      const upsertResult = await guardianLinksCollection.updateOne(
        {
          groupId: playerDoc.groupId,
          guardianMemberId: guardianMember._id,
          childMemberId: playerDoc._id
        },
        {
          $setOnInsert: {
            _id: linkId,
            groupId: playerDoc.groupId,
            guardianMemberId: guardianMember._id,
            childMemberId: playerDoc._id,
            createdAt: now
          },
          $set: {
            updatedAt: now
          }
        },
        { upsert: true }
      );

      if (upsertResult.upsertedCount > 0) {
        linkedRelations += 1;
      }
    }

    await membersCollection.updateOne(
      { _id: playerDoc._id, role: 'player' },
      {
        $unset: { guardians: '' },
        $set: { updatedAt: new Date() }
      }
    );

    cleanedPlayers += 1;
  }

  console.log(
    `🔄 Guardian migration completed: ${cleanedPlayers} players cleaned, ${createdGuardianMembers} guardian members created, ${linkedRelations} guardian-child links added`
  );
}
