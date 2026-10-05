import { CircleCheck } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ICON } from './ui';

type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
type ToastApi = (text: string, action?: Toast['action']) => void;

const Ctx = createContext<ToastApi>(() => {});
export const useToast = (): ToastApi => useContext(Ctx);

/** The design's dark pill at the bottom centre: one message at a time, gone after a few seconds, with an optional action (Undo). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const next = useRef(0);
  const show = useCallback<ToastApi>((text, action) => {
    clearTimeout(timer.current);
    setToast({ id: ++next.current, text, action });
    timer.current = setTimeout(() => setToast(null), action ? 6000 : 2800);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const api = useMemo(() => show, [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {toast && (
        <div
          key={toast.id}
          role='status'
          className='fixed left-1/2 bottom-7 z-[2000] flex items-center gap-2.5 px-3.5 py-[9px] rounded-[10px] bg-ink text-panel text-[13px] font-500 shadow-lg'
          style={{ transform: 'translateX(-50%)', animation: 'pa-pop 0.25s ease-out' }}
        >
          <span aria-hidden className='flex text-ok'>
            <CircleCheck {...ICON} />
          </span>
          {toast.text}
          {toast.action && (
            <button
              type='button'
              className='ml-1 px-2 py-0.5 border-0 rounded-md bg-transparent text-inherit font-600 underline cursor-pointer'
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
