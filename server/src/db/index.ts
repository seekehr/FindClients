import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { runMigrations } from './schema';

/**
 * A minimal, ergonomic facade over node:sqlite. The built-in types are very
 * strict (params must be SQLInputValue, results are Record<string, unknown>),
 * which fights with typed row interfaces. This facade keeps runtime behavior
 * identical while letting call sites use `.get<Row>()` / `.all<Row>()` cleanly.
 */
export interface SqlStatement {
  all<T = unknown>(...params: unknown[]): T[];
  get<T = unknown>(...params: unknown[]): T | undefined;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  close(): void;
}

// Ensure the data directory exists before opening the file.
const dir = path.dirname(env.databaseFile);
fs.mkdirSync(dir, { recursive: true });

const raw = new DatabaseSync(env.databaseFile);

// Pragmatic defaults for a small demo workload.
raw.exec('PRAGMA journal_mode = WAL;');
raw.exec('PRAGMA foreign_keys = ON;');

// The cast is safe: DatabaseSync implements exactly these methods. Only the
// TypeScript surface changes — no wrapping, no runtime cost.
export const db = raw as unknown as SqlDatabase;

runMigrations(db);

logger.info(`SQLite ready at ${env.databaseFile}`);
