import { db } from '../db';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/time';
import { hashPassword, verifyPassword } from '../utils/auth';
import { conflict, unauthorized } from '../utils/http';
import { PLAN_LIMITS } from './billing.service';
import type { Plan, PublicUser, UserRow } from '../types';

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    plan: row.plan,
    createdAt: row.created_at,
  };
}

export function findByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | UserRow
    | undefined;
}

export function findById(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export async function registerUser(input: {
  email: string;
  password: string;
  fullName?: string;
  plan?: Plan;
}): Promise<PublicUser> {
  const email = input.email.toLowerCase();
  if (findByEmail(email)) throw conflict('An account with that email already exists');

  const now = nowIso();
  const plan: Plan = input.plan ?? 'free';
  const user: UserRow = {
    id: newId('user'),
    email,
    password_hash: await hashPassword(input.password),
    full_name: input.fullName ?? '',
    plan,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, plan, created_at)
     VALUES ($id, $email, $hash, $fullName, $plan, $now)`,
  ).run({
    id: user.id,
    email: user.email,
    hash: user.password_hash,
    fullName: user.full_name,
    plan: user.plan,
    now,
  });

  // Default preferences + subscription for the new user.
  db.prepare('INSERT INTO settings (user_id, updated_at) VALUES (?, ?)').run(user.id, now);
  db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, leads_limit, updated_at)
     VALUES (?, ?, 'active', ?, ?)`,
  ).run(user.id, plan, PLAN_LIMITS[plan], now);

  return toPublic(user);
}

export async function authenticate(email: string, password: string): Promise<PublicUser> {
  const row = findByEmail(email);
  if (!row) throw unauthorized('Invalid email or password');
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw unauthorized('Invalid email or password');
  return toPublic(row);
}

export function getPublicUser(id: string): PublicUser | null {
  const row = findById(id);
  return row ? toPublic(row) : null;
}

export function updateProfile(id: string, patch: { fullName?: string; email?: string }): PublicUser {
  const row = findById(id);
  if (!row) throw unauthorized();
  if (patch.email && patch.email.toLowerCase() !== row.email) {
    const clash = findByEmail(patch.email);
    if (clash) throw conflict('That email is already in use');
  }
  const fullName = patch.fullName ?? row.full_name;
  const email = (patch.email ?? row.email).toLowerCase();
  db.prepare('UPDATE users SET full_name = ?, email = ? WHERE id = ?').run(fullName, email, id);
  return toPublic({ ...row, full_name: fullName, email });
}

export async function changePassword(id: string, current: string, next: string): Promise<void> {
  const row = findById(id);
  if (!row) throw unauthorized();
  const ok = await verifyPassword(current, row.password_hash);
  if (!ok) throw unauthorized('Current password is incorrect');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), id);
}
