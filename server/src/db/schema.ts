import type { SqlDatabase } from './index';

/**
 * Idempotent schema creation. Safe to run on every boot.
 */
export function runMigrations(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name     TEXT NOT NULL DEFAULT '',
      plan          TEXT NOT NULL DEFAULT 'free',
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      platform    TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      budget      TEXT,
      timeline    TEXT,
      url         TEXT,
      author      TEXT,
      tags        TEXT NOT NULL DEFAULT '[]',
      source_hash TEXT NOT NULL UNIQUE,
      posted_at   TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leads_platform ON leads(platform);
    CREATE INDEX IF NOT EXISTS idx_leads_posted_at ON leads(posted_at DESC);

    -- Per-user interaction with a lead (bookmark + pipeline status + notes).
    CREATE TABLE IF NOT EXISTS user_leads (
      user_id    TEXT NOT NULL,
      lead_id    TEXT NOT NULL,
      bookmarked INTEGER NOT NULL DEFAULT 0,
      status     TEXT NOT NULL DEFAULT 'new',
      notes      TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, lead_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'lead',
      title      TEXT NOT NULL,
      message    TEXT NOT NULL DEFAULT '',
      lead_id    TEXT,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

    -- One preferences row per user.
    CREATE TABLE IF NOT EXISTS settings (
      user_id             TEXT PRIMARY KEY,
      email_notifications INTEGER NOT NULL DEFAULT 1,
      push_notifications  INTEGER NOT NULL DEFAULT 1,
      new_leads_notify    INTEGER NOT NULL DEFAULT 1,
      platforms           TEXT NOT NULL DEFAULT '["upwork","twitter","discord"]',
      keywords            TEXT NOT NULL DEFAULT '[]',
      updated_at          TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id           TEXT PRIMARY KEY,
      plan              TEXT NOT NULL DEFAULT 'free',
      status            TEXT NOT NULL DEFAULT 'active',
      current_period_end TEXT,
      leads_used        INTEGER NOT NULL DEFAULT 0,
      leads_limit       INTEGER NOT NULL DEFAULT 50,
      updated_at        TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Audit log of scraping runs (powers "scraping history" + analytics).
    CREATE TABLE IF NOT EXISTS scrape_runs (
      id          TEXT PRIMARY KEY,
      platform    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'running',
      found       INTEGER NOT NULL DEFAULT 0,
      inserted    INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      started_at  TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scrape_runs_started ON scrape_runs(started_at DESC);
  `);
}
