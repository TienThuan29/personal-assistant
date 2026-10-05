import { useEffect, useState } from 'react';
import { PROVIDER_NAMES } from '../../shared/types';
import { api } from '../api';

/** The model the chat talks to: its name (empty when the provider picks), the provider's name, and whether it is set up. */
export type ModelInfo = { name: string; provider: string; ready: boolean };

export function useModelInfo(): ModelInfo | null {
  const [info, setInfo] = useState<ModelInfo | null>(null);
  useEffect(() => {
    const load = () =>
      api.settings.get().then(
        (s) => {
          const active = s.llm.active;
          setInfo({ name: s.llm[active].model, provider: PROVIDER_NAMES[active], ready: active === 'lmstudio' || s.hasKey[active] });
        },
        () => {}
      );
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);
  return info;
}
