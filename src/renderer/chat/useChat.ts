import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, ChatMessage, ImageInput, PendingAction } from '../../shared/types';
import { api, errorText } from '../api';

/** `turn`: the agent's turn failed (Thử lại helps). Otherwise an IPC call failed. */
export type ChatError = { message: string; turn: boolean };

/** Chat state for one conversation; main streams events, and the DB stays the source of truth (reload on each step). */
export function useChat(conversationId: number) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [streaming, setStreaming] = useState('');
  const [running, setRunning] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const last = useRef<AgentEvent['type'] | null>(null);
  const seq = useRef(0); // events received so far, so a slow reply can tell whether an event already set the state
  const streamed = useRef(0); // length of `streaming`, kept in step with it

  const reload = useCallback(async () => {
    const [m, a] = await Promise.all([api.chat.messages(conversationId), api.chat.actions(conversationId)]);
    setMessages(m);
    setActions(a);
    return a;
  }, [conversationId]);

  useEffect(() => {
    void reload();
    const s = seq.current;
    void api.chat.running(conversationId).then((r) => seq.current === s && setRunning(r)); // a turn left running elsewhere
    return api.chat.onEvent((e) => {
      if (e.conversationId !== conversationId) return;
      last.current = e.type;
      seq.current++;
      if (e.type === 'text') {
        streamed.current += e.delta.length;
        setStreaming((s) => s + e.delta);
        setRunning(true);
        setTool(null);
        return;
      }
      if (e.type === 'tool') {
        setRunning(true);
        setTool(e.name);
        return;
      }
      if (e.type !== 'saved') {
        setRunning(false);
        setTool(null);
      }
      if (e.type === 'error') setError({ message: e.message, turn: true });
      // Drop the streamed text only once the saved message is on screen, so it doesn't flash away and back.
      const n = streamed.current;
      streamed.current = 0;
      void reload().finally(() => setStreaming((s) => s.slice(n)));
    });
  }, [conversationId, reload]);

  /** Runs an IPC call; false (with a call error shown) if it threw. */
  const guard = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setRunning(false);
      setError({ message: errorText(e), turn: false });
      return false;
    }
  }, []);

  // Main stops a running turn before starting the next one, so the stopped turn's 'done' lands before send/retry/resolve
  // returns. The new turn is then marked running again, unless it has already ended: a config error or pending cards end
  // it before the call returns.
  const ended = () => last.current === 'error' || last.current === 'pending';

  /** True once main has accepted the message; the send box keeps its input otherwise. */
  const send = (text: string, images: ImageInput[]) =>
    guard(async () => {
      setRunning(true);
      last.current = null;
      await api.chat.send(conversationId, text, images);
      if (!ended()) setRunning(true);
      void reload(); // shows the user's message before the first event
    });
  const stop = () => void api.chat.stop(conversationId);
  const retry = () =>
    guard(async () => {
      setRunning(true);
      last.current = null;
      await api.chat.retry(conversationId);
      if (!ended()) setRunning(true);
    });

  /** False if main refused or the write failed, so "confirm all" can stop at that card. Stable, for the memoized rows. */
  const resolve = useCallback(
    async (actionId: number, decision: 'confirm' | 'cancel', args?: unknown): Promise<boolean> => {
      let ok = false;
      await guard(async () => {
        last.current = null;
        await api.chat.resolve(actionId, decision, args);
        const s = seq.current;
        const left = await reload();
        ok = !(left.find((a) => a.id === actionId)?.result as { error?: string } | null)?.error;
        // Main resumed the turn when no card is left. An event during the reload already set the state (a fast 'done').
        if (seq.current === s && !ended() && !left.some((a) => a.status === 'pending')) setRunning(true);
      });
      return ok;
    },
    [guard, reload]
  );

  return { messages, actions, streaming, running, tool, error, send, stop, retry, resolve };
}

export type ChatState = ReturnType<typeof useChat>;
