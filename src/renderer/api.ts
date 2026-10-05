import { createContext, useContext } from 'react';
import { type Api, DEFAULT_UI, type UiSettings } from '../shared/types';
import { createWebApi } from './web-api';

/** The preload's bridge in the Electron window; in a browser (Docker mode) there is none, so talk to the server instead. */
export const api = (window as unknown as { api?: Api }).api ?? createWebApi();

/** The display settings in effect; main.tsx updates it on ui:changed. */
export const UiContext = createContext<UiSettings>(DEFAULT_UI);
export const useUiSettings = (): UiSettings => useContext(UiContext);

/** IPC errors arrive as "Error invoking remote method 'x': Error: <message>". */
export const errorText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const attUrl = (id: string): string => (api.web ? `/att/${id}` : `att://${id}`);
export const splitIds = (csv: string | null | undefined): string[] => (csv ? csv.split(',') : []);
