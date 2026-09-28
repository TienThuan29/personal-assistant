import type { Resources } from '../shared/locales/vi';
import { i18n } from './i18n';

export type ErrorKey = keyof Resources['errors'];
type Translate = (key: string, params?: Record<string, unknown>) => string;
const t = i18n.t as unknown as Translate; // static keys are checked by ErrorKey, dynamic ones by exists()

/** A translated `errors` text in the main process's current language. */
export const te = (key: ErrorKey, params?: Record<string, unknown>): string => t(`errors:${key}`, params);

/** Translates 'errors:<key>' (e.g. a zod message); any other text passes through. */
export const tr = (msg: string): string => (msg.startsWith('errors:') && i18n.exists(msg) ? t(msg) : msg);

/** An error meant for the user. The message is translated at throw time (it crosses IPC as is); errMsg re-translates. */
export class UserError extends Error {
  constructor(
    public key: ErrorKey,
    public params?: Record<string, unknown>
  ) {
    super(te(key, params));
  }
}

export const errMsg = (e: unknown): string =>
  e instanceof UserError ? te(e.key, e.params) : e instanceof Error ? tr(e.message) : String(e);
