import { db } from '../db';
import { nowIso } from '../utils/time';

interface SettingsRow {
  user_id: string;
  email_notifications: number;
  push_notifications: number;
  new_leads_notify: number;
  platforms: string;
  keywords: string;
  updated_at: string;
}

function toDTO(row: SettingsRow) {
  return {
    emailNotifications: row.email_notifications === 1,
    pushNotifications: row.push_notifications === 1,
    newLeadsNotification: row.new_leads_notify === 1,
    platforms: JSON.parse(row.platforms) as string[],
    keywords: JSON.parse(row.keywords) as string[],
    updatedAt: row.updated_at,
  };
}

export function getSettings(userId: string) {
  let row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) as
    | SettingsRow
    | undefined;
  if (!row) {
    db.prepare('INSERT INTO settings (user_id, updated_at) VALUES (?, ?)').run(userId, nowIso());
    row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) as SettingsRow;
  }
  return toDTO(row);
}

export interface SettingsPatch {
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  newLeadsNotification?: boolean;
  platforms?: string[];
  keywords?: string[];
}

export function updateSettings(userId: string, patch: SettingsPatch) {
  const current = getSettings(userId);
  const merged = { ...current, ...patch };
  db.prepare(
    `UPDATE settings SET
       email_notifications = ?, push_notifications = ?, new_leads_notify = ?,
       platforms = ?, keywords = ?, updated_at = ?
     WHERE user_id = ?`,
  ).run(
    merged.emailNotifications ? 1 : 0,
    merged.pushNotifications ? 1 : 0,
    merged.newLeadsNotification ? 1 : 0,
    JSON.stringify(merged.platforms),
    JSON.stringify(merged.keywords),
    nowIso(),
    userId,
  );
  return getSettings(userId);
}
