import { drizzle } from 'drizzle-orm/d1';

export const connect = (d1: D1Database) => drizzle(d1);
export type Db = ReturnType<typeof connect>;
