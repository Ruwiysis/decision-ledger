import { getAppContext } from '@forge/api';
import { migrationRunner } from '@forge/sql';

// Forge SQL schema. Each statement is applied once per installation, in order, and
// tracked by name, so never edit an existing entry: append a new one instead.
// Forge SQL allows only one statement per call, so indexes live inside CREATE TABLE.
const CREATE_DECISIONS = `CREATE TABLE IF NOT EXISTS decisions (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  title_key VARCHAR(100) NOT NULL,
  rationale TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  topics VARCHAR(1000) NOT NULL DEFAULT '',
  source_type VARCHAR(16) NOT NULL,
  source_id VARCHAR(128) NOT NULL,
  source_url VARCHAR(1000),
  space_or_project VARCHAR(255),
  container_id VARCHAR(64),
  decided_by VARCHAR(128),
  decided_at DATETIME NOT NULL,
  superseded_by BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_decision_source (source_type, source_id, title_key),
  KEY idx_decision_status (status),
  KEY idx_decision_container (space_or_project),
  KEY idx_decision_date (decided_at)
)`;

// One row per work item that received an automatic conflict comment (at most one each).
const CREATE_GUARD_COMMENTS = `CREATE TABLE IF NOT EXISTS guard_comments (
  issue_id VARCHAR(32) NOT NULL PRIMARY KEY,
  issue_key VARCHAR(64) NOT NULL,
  decision_id BIGINT NOT NULL,
  comment_id VARCHAR(32),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

// The single migrationRunner chain for the whole app (Forge recommends exactly one).
const migrations = migrationRunner
  .enqueue('v001_create_decisions', CREATE_DECISIONS)
  .enqueue('v002_create_guard_comments', CREATE_GUARD_COMMENTS);

// Warm runtimes are reused across installations (sites), and each installation has its own
// database. So "schema is ready" must be remembered PER INSTALLATION, never globally:
// a global flag would let a new site skip its migrations. Only a promise is cached here,
// never tenant data.
const readyByInstallation = new Map();

function installationKey() {
  try {
    return getAppContext().installationAri.installationId;
  } catch {
    return null; // outside Forge (tests): never cache
  }
}

/**
 * Apply pending migrations once per installation per runtime. Every DB entry point awaits
 * this, so a fresh install works immediately instead of waiting for the hourly trigger.
 */
export function ensureSchema() {
  const key = installationKey();
  if (!key) return migrations.run();
  let ready = readyByInstallation.get(key);
  if (!ready) {
    ready = migrations.run().catch((err) => {
      readyByInstallation.delete(key); // let the next call retry
      throw err;
    });
    readyByInstallation.set(key, ready);
  }
  return ready;
}

/** Scheduled trigger handler (hourly): applies anything still pending and logs state. */
export async function runMigrations() {
  const applied = await migrations.run();
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
  const all = await migrationRunner.list();
  console.log(`[db] schema at: ${all.map((m) => m.name).join(', ') || '(none)'}`);
}
