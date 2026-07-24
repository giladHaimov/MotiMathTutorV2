import { eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { userProfiles } from '../../db/schema/product.js';

export interface Profile {
  authUserId: string;
  analyticsSubjectId: string;
  status: 'ACTIVE' | 'DELETED';
}

/**
 * Map an authenticated Better Auth user to a pseudonymous application profile
 * (ARCHITECTURE §5 Auth module, AC-004). The profile is created lazily on first
 * authenticated access. Learning records reference `analytics_subject_id`, never
 * the email (PB-032).
 */
export async function getOrCreateProfile(db: Db, authUserId: string): Promise<Profile> {
  const existing = await db
    .select({
      authUserId: userProfiles.authUserId,
      analyticsSubjectId: userProfiles.analyticsSubjectId,
      status: userProfiles.status,
    })
    .from(userProfiles)
    .where(eq(userProfiles.authUserId, authUserId));

  if (existing[0]) {
    return existing[0] as Profile;
  }

  // Create lazily; tolerate a concurrent creation via ON CONFLICT DO NOTHING.
  await db
    .insert(userProfiles)
    .values({ authUserId, status: 'ACTIVE' })
    .onConflictDoNothing({ target: userProfiles.authUserId });

  const created = await db
    .select({
      authUserId: userProfiles.authUserId,
      analyticsSubjectId: userProfiles.analyticsSubjectId,
      status: userProfiles.status,
    })
    .from(userProfiles)
    .where(eq(userProfiles.authUserId, authUserId));

  return created[0] as Profile;
}
