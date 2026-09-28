import { Message, Modal } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';

/**
 * Data page plumbing: runs `read` (after `delay` ms) and again on every data:changed and window focus, keeps only the latest
 * result, and runs row writes one at a time per row, showing failures as a message.
 * `read` must be memoized (useCallback): a new function reloads.
 */
export function useData<T>(read: () => Promise<T>, initial: T, delay = 0) {
  const [data, setData] = useState(initial);
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
        (d) => live && setData(d),
        (e) => live && failRef.current(e)
      );
    const t = setTimeout(load, delay);
    const off = api.data.onChanged(load);
    window.addEventListener('focus', load); // also re-renders date-relative views (Hôm nay) after midnight
    return () => {
      live = false;
      clearTimeout(t);
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
      title: 'Xóa?',
      content: what,
      okText: 'Xóa',
      okButtonProps: { status: 'danger' },
      onOk: () => write(id, tool, { ids: [id] }),
    });

  const holders = (
    <>
      {messageHolder}
      {modalHolder}
    </>
  );
  return { data, busy, write, remove, fail, holders };
}
