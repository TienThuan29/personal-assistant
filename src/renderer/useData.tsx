import { Message, Modal } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorText } from './api';

/**
 * Data page plumbing: runs `read` (after `delay` ms) and again on every data:changed and window focus, keeps only the latest
 * result, and runs row writes one at a time per row, showing failures as a message.
 * `read` must be memoized (useCallback): a new function reloads.
 */
export function useData<T>(read: () => Promise<T>, initial: T, delay = 0) {
  const { t } = useTranslation();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true); // until the first read settles, so pages don't flash their empty state
  const [busy, setBusy] = useState<number[]>([]);
  const [message, messageHolder] = Message.useMessage();
  const [modal, modalHolder] = Modal.useModal();
  const fail = (e: unknown) => message.error?.(errorText(e));
  const failRef = useRef(fail); // useMessage returns a new object every render
  failRef.current = fail;

  useEffect(() => {
    let live = true; // drops responses of an older `read` (e.g. a previous search query)
    const load = () =>
      void read().then(
        (d) => {
          if (!live) return;
          setData(d);
          setLoading(false);
        },
        (e) => {
          if (!live) return;
          setLoading(false);
          failRef.current(e);
        }
      );
    const timer = setTimeout(load, delay);
    const off = api.data.onChanged(load);
    window.addEventListener('focus', load); // also re-renders date-relative views (Today) after midnight
    return () => {
      live = false;
      clearTimeout(timer);
      off();
      window.removeEventListener('focus', load);
    };
  }, [read, delay]);

  /** Direct UI writes need no confirm card (design D7); data:changed triggers the reload. */
  const write = async (id: number, tool: string, args: object) => {
    if (busy.includes(id)) return;
    setBusy((b) => [...b, id]);
    try {
      await api.data.write(tool, args);
    } catch (e) {
      fail(e);
    } finally {
      setBusy((b) => b.filter((x) => x !== id));
    }
  };

  /** Asks before deleting row `id` with `tool`; `what` names it in the dialog. */
  const remove = (id: number, tool: string, what: string) =>
    modal.confirm?.({
      title: t('deleteConfirm'),
      content: what,
      okText: t('delete'),
      okButtonProps: { status: 'danger' },
      onOk: () => write(id, tool, { ids: [id] }),
    });

  const holders = (
    <>
      {messageHolder}
      {modalHolder}
    </>
  );
  return { data, loading, busy, write, remove, fail, holders };
}

/** Placeholder rows (or StatCard-sized blocks) shown while a page's first read is in flight. */
export const Skeleton = ({ variant }: { variant?: 'cards' }) =>
  variant === 'cards' ? (
    <div aria-busy='true' className='skeleton-cards grid gap-3 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]'>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className='skeleton' />
      ))}
    </div>
  ) : (
    <div aria-busy='true'>
      <div className='skeleton' />
      <div className='skeleton' />
      <div className='skeleton' />
    </div>
  );
