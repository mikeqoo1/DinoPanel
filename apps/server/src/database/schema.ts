import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => ({
    expiresIdx: index('idx_sessions_expires').on(t.expiresAt),
    userIdx: index('idx_sessions_user').on(t.userId),
  }),
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
});

export const composeStacks = sqliteTable('compose_stacks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  path: text('path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type ComposeStackRow = typeof composeStacks.$inferSelect;
export type NewComposeStackRow = typeof composeStacks.$inferInsert;
