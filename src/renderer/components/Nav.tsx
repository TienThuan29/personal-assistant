import { Tooltip } from '@arco-design/web-react';
import type { ReactNode } from 'react';

export type NavItem = { key: string; icon: ReactNode; label: string; shortcut?: string };

/** Sidebar nav of real buttons (the library's SiderItem is a div, not keyboard-accessible). */
export function Nav({
  items,
  selected,
  collapsed,
  onSelect,
  label,
}: { items: NavItem[]; selected?: string; collapsed: boolean; onSelect: (key: string) => void; label?: string }) {
  return (
    <nav aria-label={label} className='flex flex-col gap-0.5'>
      {items.map((n) => {
        const on = n.key === selected;
        const button = (
          <button
            key={n.key}
            type='button'
            aria-current={on ? 'page' : undefined}
            aria-label={collapsed ? n.label : undefined}
            onClick={() => onSelect(n.key)}
            className={`flex items-center gap-3 h-9 px-3 rounded-ctl border-0 cursor-pointer text-sm ${collapsed ? 'justify-center' : ''} ${
              on ? 'bg-accent-soft text-ink font-500' : 'bg-transparent text-ink-2 hover:bg-[var(--hover)] hover:text-ink'
            }`}
          >
            {/* Only the icon is accent: accent text on the tint over sunken is under AA. */}
            <span className={`flex shrink-0 text-base ${on ? 'text-accent' : ''}`}>{n.icon}</span>
            {!collapsed && <span className='truncate'>{n.label}</span>}
          </button>
        );
        return collapsed ? (
          <Tooltip key={n.key} position='right' content={n.shortcut ? `${n.label} (${n.shortcut})` : n.label}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </nav>
  );
}
