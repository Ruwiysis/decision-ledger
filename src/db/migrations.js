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

// The single migrationRunner chain for the whole app (Forge recommends exactly one).
const migrations = migrationRunner.enqueue('v001_create_decisions', CREATE_DECISIONS);

let ready = null;

/**
 * Apply pending migrations once per function runtime. Every DB entry point awaits this,
 * so a fresh install works immediately instead of waiting for the hourly trigger.
 */
export function ensureSchema() {
  if (!ready) {
    ready = migrations.run().catch((err) => {
      ready = null; // let the next call retry
      throw err;
    });
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
