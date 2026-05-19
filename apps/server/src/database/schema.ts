import { sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// ---------------------------------------------------------------------------
// v0.5 — firewall + scheduler + audit/login logs
// ---------------------------------------------------------------------------

export const firewallRuleMeta = sqliteTable('firewall_rule_meta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  port: integer('port').notNull(),
  proto: text('proto', { enum: ['tcp', 'udp', 'any'] }).notNull(),
  source: text('source'),
  action: text('action', { enum: ['allow', 'deny'] }).notNull(),
  comment: text('comment'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  stagedAt: integer('staged_at'),
  confirmingAt: integer('confirming_at'),
  confirmedAt: integer('confirmed_at'),
});

export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', {
    enum: [
      'shell',
      'backup_files',
      'clean_logs',
      'restart_service',
      'http_request',
      'purge',
      'acme_renew',
    ],
  }).notNull(),
  cron: text('cron').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const scheduledRuns = sqliteTable(
  'scheduled_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id')
      .notNull()
      .references(() => scheduledTasks.id, { onDelete: 'cascade' }),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    status: text('status', {
      enum: ['running', 'success', 'failed', 'aborted'],
    }).notNull(),
    exitCode: integer('exit_code'),
    output: text('output'),
  },
  (t) => ({
    taskIdx: index('idx_scheduled_runs_task').on(t.taskId),
    startedIdx: index('idx_scheduled_runs_started').on(t.startedAt),
  }),
);

export const operationLog = sqliteTable(
  'operation_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id),
    method: text('method').notNull(),
    path: text('path').notNull(),
    bodySummary: text('body_summary'),
    statusCode: integer('status_code').notNull(),
    durationMs: integer('duration_ms').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => ({
    createdIdx: index('idx_operation_log_created').on(t.createdAt),
    userIdx: index('idx_operation_log_user').on(t.userId),
    pathIdx: index('idx_operation_log_path').on(t.path),
  }),
);

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    result: text('result', { enum: ['success', 'fail'] }).notNull(),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => ({
    createdIdx: index('idx_login_attempts_created').on(t.createdAt),
    usernameIdx: index('idx_login_attempts_username').on(t.username),
  }),
);

// ---------------------------------------------------------------------------
// v0.3 — websites + ACME SSL
// ---------------------------------------------------------------------------

export const sites = sqliteTable(
  'sites',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    primaryDomain: text('primary_domain').notNull(),
    type: text('type', {
      enum: ['static', 'reverse_proxy', 'php'],
    }).notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    managedByDinopanel: integer('managed_by_dinopanel', { mode: 'boolean' })
      .notNull()
      .default(true),
    orphaned: integer('orphaned', { mode: 'boolean' }).notNull().default(false),
    certPaths: text('cert_paths', { mode: 'json' }),
    certExpiresAt: integer('cert_expires_at'),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => ({
    domainIdx: index('idx_sites_primary_domain').on(t.primaryDomain),
  }),
);

export const acmeAccounts = sqliteTable(
  'acme_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    directoryUrl: text('directory_url').notNull(),
    email: text('email').notNull(),
    keyPem: text('key_pem').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => ({
    pairIdx: uniqueIndex('uniq_acme_accounts_pair').on(t.directoryUrl, t.email),
  }),
);

export const acmeOrders = sqliteTable(
  'acme_orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: integer('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    challenge: text('challenge', { enum: ['http-01', 'dns-01'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'success', 'failed'],
    }).notNull(),
    errorMessage: text('error_message'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => ({
    siteIdx: index('idx_acme_orders_site').on(t.siteId),
    startedIdx: index('idx_acme_orders_started').on(t.startedAt),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type ComposeStackRow = typeof composeStacks.$inferSelect;
export type NewComposeStackRow = typeof composeStacks.$inferInsert;
export type FirewallRuleMeta = typeof firewallRuleMeta.$inferSelect;
export type NewFirewallRuleMeta = typeof firewallRuleMeta.$inferInsert;
export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type NewScheduledTask = typeof scheduledTasks.$inferInsert;
export type ScheduledRun = typeof scheduledRuns.$inferSelect;
export type NewScheduledRun = typeof scheduledRuns.$inferInsert;
export type OperationLogRow = typeof operationLog.$inferSelect;
export type NewOperationLogRow = typeof operationLog.$inferInsert;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;
export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type AcmeAccount = typeof acmeAccounts.$inferSelect;
export type NewAcmeAccount = typeof acmeAccounts.$inferInsert;
export type AcmeOrder = typeof acmeOrders.$inferSelect;
export type NewAcmeOrder = typeof acmeOrders.$inferInsert;
