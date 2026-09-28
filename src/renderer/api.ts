import type { Api } from '../shared/types';

export const api = (window as unknown as { api: Api }).api;

/** IPC errors arrive as "Error invoking remote method 'x': Error: <message>". */
export const errorText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const attUrl = (id: string): string => `att://${id}`;
export const splitIds = (csv: string | null | undefined): string[] => (csv ? csv.split(',') : []);
