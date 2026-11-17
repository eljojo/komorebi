import { eq } from 'drizzle-orm';
import { RESERVED_USERNAMES } from './config';
import type { Db } from './db/client';
import { users } from './db/schema';
import { ApiError } from './errors';

// Returns the name as it is stored (lowercase), or refuses it with a plain message.
export async function freeUsername(db: Db, raw: unknown): Promise<string> {
  const name = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (!/^[a-z][a-z0-9-]{2,29}$/.test(name)) {
    throw new ApiError(400, 'a username is 3 to 30 characters: letters, digits and hyphens, starting with a letter');
  }
  if (RESERVED_USERNAMES.includes(name)) throw new ApiError(400, `the username ${name} is reserved`);
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, name));
  if (taken) throw new ApiError(409, `the username ${name} is taken`);
  return name;
}
