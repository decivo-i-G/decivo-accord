import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/*
 * The register lives in the customer's repository. The database only keeps what builds up over time and
 * between people: connections, proposals, check answers, review decisions, drift reports and the audit log.
 */

const id = () => text('id').primaryKey().default(sql`gen_random_uuid()`)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

// --- Sign-in (better-auth core tables) ---

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// --- Accord ---

export const surfaceEnum = pgEnum('surface_kind', ['code', 'claude-design', 'figma', 'pen'])
export const ownerEnum = pgEnum('owner', ['design', 'code', 'register'])
export const routeEnum = pgEnum('route', ['auto', 'reset', 'explain', 'owner'])
export const proposalStatusEnum = pgEnum('proposal_status', ['open', 'accepted', 'rejected', 'superseded'])
export const reviewDecisionEnum = pgEnum('review_decision', ['accept', 'reject', 'comment'])

export const installation = pgTable('installation', {
  id: id(),
  githubInstallationId: integer('github_installation_id').unique(),
  account: text('account').notNull(),
  createdAt: createdAt(),
})

export const repository = pgTable(
  'repository',
  {
    id: id(),
    installationId: text('installation_id').references(() => installation.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    registerPath: text('register_path').notNull().default('.accord'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('repository_slug').on(t.slug)],
)

/** A connected surface. Credentials are encrypted by the application (AES-GCM, key from the environment). */
export const surface = pgTable(
  'surface',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    kind: surfaceEnum('kind').notNull(),
    settings: jsonb('settings').notNull().default({}),
    credentialsEncrypted: text('credentials_encrypted'),
    connectedAt: createdAt(),
  },
  (t) => [uniqueIndex('surface_repository_kind').on(t.repositoryId, t.kind)],
)

export const snapshot = pgTable(
  'snapshot',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    surface: surfaceEnum('surface').notNull(),
    hash: text('hash').notNull(),
    /** Normalised snapshot (tokens, components, coverage). */
    data: jsonb('data').notNull(),
    origin: text('origin').notNull(),
    capturedAt: createdAt(),
  },
  (t) => [index('snapshot_repository_surface').on(t.repositoryId, t.surface, t.capturedAt)],
)

export const proposal = pgTable(
  'proposal',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    /** Human-readable id, e.g. P-20261012-landing. */
    key: text('key').notNull(),
    title: text('title').notNull(),
    source: surfaceEnum('source').notNull(),
    intent: text('intent').notNull(),
    status: proposalStatusEnum('status').notNull().default('open'),
    route: routeEnum('route').notNull(),
    decider: ownerEnum('decider'),
    risk: text('risk').notNull(),
    confidence: real('confidence').notNull(),
    baseSha: text('base_sha'),
    branch: text('branch'),
    pullRequest: integer('pull_request'),
    /** Full evaluation (items, violations, reasons) as produced by @decivo/accord-checks. */
    evaluation: jsonb('evaluation').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('proposal_repository_key').on(t.repositoryId, t.key),
    index('proposal_status').on(t.repositoryId, t.status),
  ],
)

/** Every answer of the check layer, for audit and per-customer calibration. */
export const checkAnswer = pgTable('check_answer', {
  id: id(),
  proposalId: text('proposal_id')
    .notNull()
    .references(() => proposal.id, { onDelete: 'cascade' }),
  questionId: text('question_id').notNull(),
  question: text('question').notNull(),
  answer: jsonb('answer').notNull(),
  pRaw: real('p_raw').notNull(),
  pCalibrated: real('p_calibrated'),
  provider: text('provider').notNull(),
  costMicrousd: integer('cost_microusd'),
  latencyMs: integer('latency_ms'),
  createdAt: createdAt(),
})

/** A human decision on a proposal. Together with the check answers it forms the labelled examples. */
export const review = pgTable('review', {
  id: id(),
  proposalId: text('proposal_id')
    .notNull()
    .references(() => proposal.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  decision: reviewDecisionEnum('decision').notNull(),
  comment: text('comment'),
  createdAt: createdAt(),
})

export const driftReport = pgTable(
  'drift_report',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha'),
    healthScore: integer('health_score').notNull(),
    /** Report as produced by `accord diff --json`. */
    report: jsonb('report').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('drift_report_repository').on(t.repositoryId, t.createdAt)],
)

/** Append-only: who accepted, rejected or projected what, and when. Never updated or deleted by the app. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    repositoryId: text('repository_id').references(() => repository.id, { onDelete: 'set null' }),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    subject: text('subject').notNull(),
    detail: jsonb('detail').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_repository').on(t.repositoryId, t.createdAt)],
)
