// App shortcuts use Cmd on macOS and Ctrl elsewhere (issue #8).
type Keys = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>;

/** True when the platform's command modifier is down and the other one is not. */
export const hasMod = (e: Keys, mac: boolean): boolean => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/** How a shortcut is written in hints: '⌘N' on macOS, 'Ctrl+N' elsewhere. */
export const shortcutLabel = (key: string, mac: boolean): string => (mac ? `⌘${key}` : `Ctrl+${key}`);
