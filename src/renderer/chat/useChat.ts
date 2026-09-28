import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, ChatMessage, ImageInput, PendingAction } from '../../shared/types';
import { api, errorText } from '../api';

/** Chat state for one conversation; main streams events, and the DB stays the source of truth (reload on each step). */
export function useChat(conversationId: number) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [streaming, setStreaming] = useState('');
  const [running, setRunning] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<AgentEvent['type'] | null>(null);

  const reload = useCallback(async () => {
    const [m, a] = await Promise.all([api.chat.messages(conversationId), api.chat.actions(conversationId)]);
    setMessages(m);
    setActions(a);
    return a;
  }, [conversationId]);

  useEffect(() => {
    void reload();
    return api.chat.onEvent((e) => {
      if (e.conversationId !== conversationId) return;
      last.current = e.type;
      if (e.type === 'text') {
        setStreaming((s) => s + e.delta);
        setTool(null);
        return;
      }
      if (e.type === 'tool') {
        setTool(e.name);
        return;
      }
      setStreaming('');
      if (e.type !== 'saved') {
        setRunning(false);
        setTool(null);
      }
      if (e.type === 'error') setError(e.message);
      void reload();
    });
  }, [conversationId, reload]);

  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setRunning(false);
      setError(errorText(e));
    }
  }, []);

  // Main stops a running turn before starting the next one, so the stopped turn's 'done' lands before send/retry/resolve
  // returns. The new turn is then marked running again, unless it has already ended: a config error or pending cards end
  // it before the call returns.
  const ended = () => last.current === 'error' || last.current === 'pending';

  const send = (text: string, images: ImageInput[]) =>
    guard(async () => {
      setRunning(true);
      last.current = null;
      await api.chat.send(conversationId, text, images);
      if (!ended()) setRunning(true);
      await reload();
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
        const left = await reload();
        ok = !(left.find((a) => a.id === actionId)?.result as { error?: string } | null)?.error;
        if (!left.some((a) => a.status === 'pending') && !ended()) setRunning(true); // main resumed the turn
      });
      return ok;
    },
    [guard, reload]
  );

  return { messages, actions, streaming, running, tool, error, send, stop, retry, resolve };
}

export type ChatState = ReturnType<typeof useChat>;
