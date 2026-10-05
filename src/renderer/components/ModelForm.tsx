import { Message, Select } from '@arco-design/web-react';
import { CircleCheck, Lock, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LLM, type LlmSettings, type Provider, PROVIDER_NAMES, type SettingsView } from '../../shared/types';
import { api, errorText } from '../api';
import { Btn, ICON, IconBtn, Segmented, SettingRow } from './ui';

const FIELD = 'h-9 w-full px-3 rounded-lg border border-solid border-line bg-panel text-[13px] outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]';

/** The connection settings of the active provider: what Settings' "AI model" and the setup guide's second step share. */
export function useModelForm() {
  const { t } = useTranslation('settings');
  const [view, setView] = useState<SettingsView | null>(null);
  const [llm, setLlm] = useState<LlmSettings>(DEFAULT_LLM);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [message, messageHolder] = Message.useMessage();
  const report = (type: 'success' | 'error', text: string) => {
    setStatus({ type, text });
    message[type]?.(text);
  };

  /** The saved endpoint's model ids (gateway or LM Studio). `quiet` (automatic loads) skips the error toast when nothing is set up yet or offline. */
  const loadModels = (quiet: boolean) => {
    setLoadingModels(true);
    api.settings
      .listModels(llm.active)
      .then(setModels, (e) => {
        setModels([]); // don't offer models of an endpoint that no longer answers
        if (!quiet) message.error?.(errorText(e));
      })
      .finally(() => setLoadingModels(false));
  };

  useEffect(() => {
    api.settings
      .get()
      .then((v) => {
        setView(v);
        setLlm(v.llm);
      })
      .catch((e) => setStatus({ type: 'error', text: errorText(e) }));
  }, []);

  // Load the list once a listing provider is shown and set up (on open, on switching to it, after saving it). A gateway also
  // needs its token; LM Studio is ready with its default local address.
  const modelsReady =
    llm.active === 'gateway' ? !!view?.hasKey.gateway && !!view.llm.gateway.endpoint : llm.active === 'lmstudio' && !!view?.llm.lmstudio.endpoint;
  useEffect(() => {
    if (modelsReady) loadModels(true);
  }, [modelsReady, llm.active, view]); // not loadModels: a new closure each render

  const set = (patch: Partial<LlmSettings[Provider]>) => setLlm((l) => ({ ...l, [l.active]: { ...l[l.active], ...patch } }));
  const setProvider = (active: Provider) => {
    setLlm((l) => ({ ...l, active }));
    setApiKey('');
    setModels([]); // the previous provider's list does not apply
    setStatus(null);
  };
  const save = async () => {
    await api.settings.save({ llm, apiKey: apiKey || undefined });
    setApiKey('');
    setView(await api.settings.get());
  };
  const run = (kind: 'save' | 'test', fn: () => Promise<string>) => async () => {
    setBusy(kind);
    setStatus(null);
    try {
      report('success', await fn());
    } catch (e) {
      report('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const onSave = run('save', async () => (await save(), t('saved')));
  const onTest = run('test', async () => (await save(), t('testOk', { reply: await api.settings.test() })));
  return { view, llm, set, setProvider, apiKey, setApiKey, models, loadingModels, loadModels, busy, status, onSave, onTest, messageHolder, save, report };
}

export type ModelFormState = ReturnType<typeof useModelForm>;

/** The fields; `compact` is the setup guide's version, with no Save button and a test that saves first. */
export function ModelForm({ m, compact }: { m: ModelFormState; compact?: boolean }) {
  const { t } = useTranslation('settings');
  const { llm, view } = m;
  const active = llm.active;
  const azure = active === 'azure';
  const local = active === 'lmstudio';
  const cfg = llm[active];
  const keyLabel = azure ? 'API key' : t('accessToken');
  if (!view) return m.status ? <div className='text-danger text-[13px]'>{m.status.text}</div> : null;
  const Row = compact ? ({ children, label, desc }: { children: React.ReactNode; label: string; desc?: string }) => (
    <div className='flex flex-col gap-1.5'>
      <label className='text-[12.5px] font-500 text-ink-2'>{label}</label>
      {children}
      {desc && <div className='text-xs text-ink-2'>{desc}</div>}
    </div>
  ) : null;
  const wrap = (label: string, desc: string | undefined, control: React.ReactNode, last = false) =>
    Row ? <Row label={label} desc={desc}>{control}</Row> : <SettingRow stacked last={last} label={label} desc={desc}>{control}</SettingRow>;

  return (
    <div className={compact ? 'flex flex-col gap-3.5' : 'flex flex-col'}>
      {m.messageHolder}
      {compact ? (
        <Segmented
          label={t('provider')}
          value={active}
          onChange={m.setProvider}
          className='self-start'
          options={(['azure', 'gateway', 'lmstudio'] as const).map((p) => ({ value: p, label: PROVIDER_NAMES[p] }))}
        />
      ) : (
        <SettingRow label={t('provider')} desc={t('providerDesc')}>
          <Segmented label={t('provider')} value={active} onChange={m.setProvider} options={(['azure', 'gateway', 'lmstudio'] as const).map((p) => ({ value: p, label: PROVIDER_NAMES[p] }))} />
        </SettingRow>
      )}
      {wrap('Endpoint', azure ? t('endpointAzure') : local ? t('endpointLmstudio') : t('endpointGateway'), <input aria-label='Endpoint' placeholder={local ? 'http://localhost:1234' : 'https://…'} value={cfg.endpoint} onChange={(e) => m.set({ endpoint: e.target.value })} className={`${FIELD} font-mono`} />)}
      {wrap(
        azure ? 'Deployment' : 'Model',
        azure ? t('modelDesc') : local ? t('modelDescLmstudio') : t('modelDescGateway'),
        azure ? (
          <input aria-label='Deployment' placeholder={t('modelPlaceholder')} value={cfg.model} onChange={(e) => m.set({ model: e.target.value })} className={`${FIELD} font-mono`} />
        ) : (
          <div className='flex gap-2'>
            {/* allowCreate: a name the list lacks can still be typed; allowClear: empty lets the gateway (or LM Studio's loaded model) pick. */}
            <Select
              aria-label='Model'
              placeholder={t('modelOptional')}
              value={cfg.model || undefined}
              showSearch
              allowCreate
              allowClear
              loading={m.loadingModels}
              onChange={(v?: string) => m.set({ model: v ?? '' })}
              style={{ flex: 1 }}
              options={[...new Set([...m.models, ...(cfg.model ? [cfg.model] : [])])]}
            />
            <IconBtn label={t('reloadModels')} icon={<RefreshCw {...ICON} />} className='!w-9 !h-9 border border-solid border-line !rounded-lg' onClick={() => m.loadModels(false)} />
          </div>
        )
      )}
      {azure && wrap('API version', undefined, <input aria-label='API version' value={llm.azure.apiVersion} onChange={(e) => m.set({ apiVersion: e.target.value })} className={`${FIELD} font-mono`} />)}
      {!local &&
        wrap(
          keyLabel,
          view.hasKey[active] ? t('keySaved') : t('keyMissing'),
          <input
            type='password'
            aria-label={keyLabel}
            placeholder={view.hasKey[active] ? t('keySavedPlaceholder') : undefined}
            value={m.apiKey}
            onChange={(e) => m.setApiKey(e.target.value)}
            className={FIELD}
          />,
          true
        )}
      <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'pt-4'}`}>
        {!compact && (
          <Btn variant='primary' disabled={m.busy !== null} onClick={() => void m.onSave()}>
            {m.busy === 'save' ? t('saving') : t('save')}
          </Btn>
        )}
        <Btn disabled={m.busy !== null} onClick={() => void m.onTest()}>
          {m.busy === 'test' ? t('testing') : t('saveAndTest')}
        </Btn>
        {!local && view.hasKey[active] && (
          <span className='flex items-center gap-1 text-xs text-ok'>
            <Lock {...ICON} />
            {t('keyEncrypted')}
          </span>
        )}
      </div>
      {m.status && (
        <div role='status' className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-[13px] ${m.status.type === 'success' ? 'bg-ok-soft' : 'bg-danger-soft'}`}>
          <span aria-hidden className={`flex text-base ${m.status.type === 'success' ? 'text-ok' : 'text-danger'}`}>
            <CircleCheck {...ICON} />
          </span>
          {m.status.text}
        </div>
      )}
    </div>
  );
}
