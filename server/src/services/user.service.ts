import type { AuthError, User } from '@supabase/supabase-js';
import { supabase, unwrap } from '../db/supabase';
import { env } from '../config/env';
import { conflict, HttpError, unauthorized } from '../utils/http';
import { logger } from '../utils/logger';
import type { Plan, ProfileRow, PublicUser } from '../types';

/**
 * User identity is owned by Supabase Auth (auth.users). `public.profiles`
 * mirrors it with the app-level fields (display name, plan) and is populated by
 * the on_auth_user_created trigger in supabase/migrations/0001_init.sql.
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds at which the access token expires. */
  expiresAt: number | null;
}

function toPublic(row: ProfileRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    plan: row.plan,
    createdAt: row.created_at,
  };
}

/** Translate a Supabase auth failure into our HTTP error vocabulary. */
function authFailure(error: AuthError, fallback: string): HttpError {
  const message = error.message || fallback;
  if (/already registered|already been registered|already exists/i.test(message)) {
    return conflict('An account with that email already exists');
  }
  if (/invalid login credentials/i.test(message)) {
    return unauthorized('Invalid email or password');
  }
  if (/email not confirmed/i.test(message)) {
    return unauthorized('Please confirm your email address before signing in');
  }
  if (error.status && error.status >= 400 && error.status < 500) {
    return new HttpError(error.status, message);
  }
  logger.error('Supabase auth error', message);
  return new HttpError(500, fallback);
}

async function getProfile(id: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logger.error('Failed to load profile', error.message);
    throw new HttpError(500, 'Could not load your profile');
  }
  return (data as ProfileRow | null) ?? null;
}

/**
 * The provisioning trigger runs inside the same transaction as the auth insert,
 * so the profile is normally there immediately. This is the safety net for a
 * project where the migration's trigger was never installed.
 */
async function ensureProfile(user: User): Promise<ProfileRow> {
  const existing = await getProfile(user.id);
  if (existing) return existing;

  logger.warn(`No profile row for ${user.id} — creating one (is the migration applied?)`);
  const fullName = (user.user_metadata?.full_name as string | undefined) ?? '';
  const row = unwrap(
    await supabase
      .from('profiles')
      .upsert(
        { id: user.id, email: user.email ?? '', full_name: fullName, plan: 'free' },
        { onConflict: 'id' },
      )
      .select()
      .single(),
    'creating your profile',
  ) as ProfileRow;

  await supabase.from('user_config').upsert({ user_id: user.id }, { onConflict: 'user_id' });
  await supabase
    .from('subscriptions')
    .upsert({ user_id: user.id, plan: 'free', leads_limit: 50 }, { onConflict: 'user_id' });

  return row;
}

export async function registerUser(input: {
  email: string;
  password: string;
  fullName?: string;
}): Promise<{ user: PublicUser; session: Session | null }> {
  const email = input.email.toLowerCase();
  const fullName = input.fullName ?? '';

  if (env.autoConfirmEmails) {
    // Admin create so the account is usable immediately, then sign in for real
    // tokens. createUser does not return a session by design.
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw authFailure(error, 'Could not create your account');
    if (!data.user) throw new HttpError(500, 'Could not create your account');

    await ensureProfile(data.user);
    return signIn(email, input.password);
  }

  // Normal sign-up: Supabase emails a confirmation link. No session until the
  // user confirms, so the client is told to check their inbox.
  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw authFailure(error, 'Could not create your account');
  if (!data.user) throw new HttpError(500, 'Could not create your account');

  const profile = await ensureProfile(data.user);
  return {
    user: toPublic(profile),
    session: data.session
      ? {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at ?? null,
        }
      : null,
  };
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ user: PublicUser; session: Session }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase(),
    password,
  });
  if (error) throw authFailure(error, 'Could not sign you in');
  if (!data.session || !data.user) throw unauthorized('Invalid email or password');

  const profile = await ensureProfile(data.user);
  return {
    user: toPublic(profile),
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
    },
  };
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshSession(
  refreshToken: string,
): Promise<{ user: PublicUser; session: Session }> {
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw authFailure(error, 'Could not refresh your session');
  if (!data.session || !data.user) throw unauthorized('Session expired, please sign in again');

  const profile = await ensureProfile(data.user);
  return {
    user: toPublic(profile),
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
    },
  };
}

export async function signOut(accessToken: string): Promise<void> {
  // Best effort: revoking the refresh token is a courtesy, not a correctness
  // requirement — the access token is short-lived and self-verifying.
  const { error } = await supabase.auth.admin.signOut(accessToken);
  if (error) logger.warn(`Sign-out revocation failed: ${error.message}`);
}

export async function getPublicUser(id: string): Promise<PublicUser | null> {
  const row = await getProfile(id);
  return row ? toPublic(row) : null;
}

export async function updateProfile(
  id: string,
  patch: { fullName?: string; email?: string },
): Promise<PublicUser> {
  const current = await getProfile(id);
  if (!current) throw unauthorized();

  const email = patch.email?.toLowerCase();

  // The email lives in auth.users; changing it there is what makes the new
  // address usable for sign-in. A trigger mirrors it onto profiles.
  if (email && email !== current.email) {
    const { error } = await supabase.auth.admin.updateUserById(id, {
      email,
      email_confirm: env.autoConfirmEmails,
    });
    if (error) throw authFailure(error, 'Could not update your email address');
  }

  if (patch.fullName !== undefined) {
    await supabase.auth.admin.updateUserById(id, {
      user_metadata: { full_name: patch.fullName },
    });
  }

  const row = unwrap(
    await supabase
      .from('profiles')
      .update({
        full_name: patch.fullName ?? current.full_name,
        email: email ?? current.email,
      })
      .eq('id', id)
      .select()
      .single(),
    'updating your profile',
  ) as ProfileRow;

  return toPublic(row);
}

export async function changePassword(
  id: string,
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  // Supabase's admin update does not verify the old password, so prove the
  // caller knows it by signing in with it first.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase(),
    password: currentPassword,
  });
  if (verifyError) throw unauthorized('Current password is incorrect');

  const { error } = await supabase.auth.admin.updateUserById(id, { password: newPassword });
  if (error) throw authFailure(error, 'Could not change your password');
}

/** Set a user's plan on both the profile and their auth metadata. */
export async function setPlan(id: string, plan: Plan): Promise<void> {
  unwrap(
    await supabase.from('profiles').update({ plan }).eq('id', id).select('id').single(),
    'updating your plan',
  );
}

export async function deleteAccount(id: string): Promise<void> {
  // Every table cascades from auth.users, so this removes the user's data too.
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) throw authFailure(error, 'Could not delete your account');
}

/** Every user id in the system — used by the notification fan-out. */
export async function listUserIds(): Promise<string[]> {
  const rows = unwrap(await supabase.from('profiles').select('id'), 'listing users') as {
    id: string;
  }[];
  return rows.map((r) => r.id);
}
