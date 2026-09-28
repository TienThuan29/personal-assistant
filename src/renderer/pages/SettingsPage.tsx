import { AionSelect, PreferenceRow, SectionCard, SettingsPageHeader } from '@aionui/ui';
import { Alert, Button, Input, Message, Select, Space, Switch } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../shared/money';
import { DEFAULT_LLM, type LlmSettings, type Provider, PROVIDER_NAMES, type SettingsView, type UiSettings } from '../../shared/types';
import { api, errorText, useUiSettings } from '../api';

const CURRENCIES = ['VND', 'USD', 'EUR', 'JPY'];
const EXAMPLE_AMOUNT = 1_234_500; // minor units: 1.234.500 ₫ or $12,345.00

/** Applied at once; main broadcasts ui:changed, which updates the language and the context (main.tsx). */
function DisplayCard() {
  const { t } = useTranslation('settings');
  const ui = useUiSettings();
  const [message, messageHolder] = Message.useMessage();
  const setUi = (patch: Partial<UiSettings>) => void api.settings.setUi(patch).catch((e) => message.error?.(errorText(e)));
  const example = (style: UiSettings['moneyStyle']) => formatMoney(EXAMPLE_AMOUNT, ui.defaultCurrency, style);
  return (
    <SectionCard title={t('display')}>
      {messageHolder}
      <PreferenceRow label={t('language')} description={t('languageDesc')}>
        <AionSelect
          aria-label={t('language')}
          value={ui.language}
          onChange={(language: UiSettings['language']) => setUi({ language })}
          style={{ width: 380 }}
          options={[
            { label: t('langVi'), value: 'vi' },
            { label: t('langEn'), value: 'en' },
          ]}
        />
      </PreferenceRow>
      <PreferenceRow label={t('moneyStyle')} description={t('moneyStyleDesc')}>
        <AionSelect
          aria-label={t('moneyStyle')}
          value={ui.moneyStyle}
          onChange={(moneyStyle: UiSettings['moneyStyle']) => setUi({ moneyStyle })}
          style={{ width: 380 }}
          options={[
            { label: t('moneyVi', { example: example('vi') }), value: 'vi' },
            { label: t('moneyIntl', { example: example('intl') }), value: 'intl' },
          ]}
        />
      </PreferenceRow>
      <PreferenceRow label={t('defaultCurrency')} description={t('defaultCurrencyDesc')}>
        {/* allowCreate: type any other 3-letter ISO code (anything else is ignored); main validates it and a bad one shows as a message. */}
        <Select
          aria-label={t('defaultCurrency')}
          value={ui.defaultCurrency}
          showSearch
          allowCreate
          onChange={(defaultCurrency: string) => /^[A-Za-z]{3}$/.test(defaultCurrency) && setUi({ defaultCurrency })}
          style={{ width: 380 }}
          options={[...new Set([...CURRENCIES, ui.defaultCurrency])]}
        />
      </PreferenceRow>
    </SectionCard>
  );
}

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const [view, setView] = useState<SettingsView | null>(null);
  const [llm, setLlm] = useState<LlmSettings>(DEFAULT_LLM);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  // Toasts too: the page scrolls, and the inline Alert at the bottom is easy to miss.
  const [message, messageHolder] = Message.useMessage();
  const report = (type: 'success' | 'error', text: string) => {
    setStatus({ type, text });
    message[type]?.(text);
  };

  /** The saved gateway's model ids. `quiet` (automatic loads) skips the error toast when nothing is set up yet or offline. */
  const loadModels = (quiet: boolean) => {
    setLoadingModels(true);
    api.settings
      .listModels('gateway')
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
        setOpenAtLogin(v.openAtLogin);
      })
      .catch((e) => setStatus({ type: 'error', text: errorText(e) }));
  }, []);

  // Load the list once the gateway is shown and set up (on open, on switching to it, after saving its key).
  const gatewayReady = llm.active === 'gateway' && !!view?.hasKey.gateway && !!view.llm.gateway.endpoint;
  useEffect(() => {
    if (gatewayReady) loadModels(true);
  }, [gatewayReady, view]); // not loadModels: a new closure each render

  const active = llm.active;
  const set = (patch: Partial<LlmSettings[Provider]>) => setLlm((l) => ({ ...l, [l.active]: { ...l[l.active], ...patch } }));
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

  if (!view)
    return status ? (
      <div className='page'>
        <Alert type='error' content={status.text} />
      </div>
    ) : null;
  const azure = active === 'azure';
  const cfg = llm[active];
  const keyLabel = azure ? 'API key' : 'Access token';
  return (
    <div className='page settings'>
      {messageHolder}
      <SettingsPageHeader title={t('title')} sticky={false} />
      <DisplayCard />
      <SectionCard title={t('model')}>
        <PreferenceRow label={t('provider')} description={t('providerDesc')}>
          <AionSelect
            aria-label={t('provider')}
            value={active}
            onChange={(v: Provider) => {
              setLlm((l) => ({ ...l, active: v }));
              setApiKey('');
            }}
            style={{ width: 380 }}
            options={[
              { label: PROVIDER_NAMES.azure, value: 'azure' },
              { label: PROVIDER_NAMES.gateway, value: 'gateway' },
            ]}
          />
        </PreferenceRow>
        <PreferenceRow label='Endpoint' description={azure ? t('endpointAzure') : t('endpointGateway')}>
          <Input aria-label='Endpoint' placeholder='https://…' value={cfg.endpoint} onChange={(v) => set({ endpoint: v })} style={{ width: 380 }} />
        </PreferenceRow>
        <PreferenceRow label={azure ? 'Deployment' : 'Model'} description={azure ? t('modelDesc') : t('modelDescGateway')}>
          {azure ? (
            <Input
              aria-label='Deployment'
              placeholder={t('modelPlaceholder')}
              value={cfg.model}
              onChange={(v) => set({ model: v })}
              style={{ width: 380 }}
            />
          ) : (
            <Space size={4}>
              {/* allowCreate: a name the list lacks can still be typed; allowClear: empty lets the gateway pick. */}
              <Select
                aria-label='Model'
                placeholder={t('modelOptional')}
                value={cfg.model || undefined}
                showSearch
                allowCreate
                allowClear
                loading={loadingModels}
                onChange={(v?: string) => set({ model: v ?? '' })}
                style={{ width: 344 }}
                options={[...new Set([...models, ...(cfg.model ? [cfg.model] : [])])]}
              />
              <Button aria-label={t('reloadModels')} title={t('reloadModels')} icon={<Refresh />} loading={loadingModels} onClick={() => loadModels(false)} />
            </Space>
          )}
        </PreferenceRow>
        {azure && (
          <PreferenceRow label='API version'>
            <Input aria-label='API version' value={llm.azure.apiVersion} onChange={(v) => set({ apiVersion: v })} style={{ width: 380 }} />
          </PreferenceRow>
        )}
        <PreferenceRow
          label={keyLabel}
          description={view.hasKey[active] ? t('keySaved') : t('keyMissing')}
        >
          <Input.Password
            aria-label={keyLabel}
            placeholder={view.hasKey[active] ? t('keySavedPlaceholder') : undefined}
            value={apiKey}
            onChange={setApiKey}
            style={{ width: 380 }}
          />
        </PreferenceRow>
      </SectionCard>
      <SectionCard title={t('system')}>
        <PreferenceRow label={t('openAtLogin')} description={t('openAtLoginDesc')}>
          <Switch
            aria-label={t('openAtLogin')}
            checked={openAtLogin}
            onChange={(on: boolean) =>
              api.settings.setOpenAtLogin(on).then(setOpenAtLogin, (e) => report('error', errorText(e)))
            }
          />
        </PreferenceRow>
      </SectionCard>
      <Space>
        <Button
          type='primary'
          loading={busy === 'save'}
          disabled={busy === 'test'}
          onClick={run('save', async () => (await save(), t('saved')))}
        >
          {t('save')}
        </Button>
        <Button
          loading={busy === 'test'}
          disabled={busy === 'save'}
          onClick={run('test', async () => (await save(), t('testOk', { reply: await api.settings.test() })))}
        >
          {t('saveAndTest')}
        </Button>
      </Space>
      {status && <Alert type={status.type} content={status.text} />}
    </div>
  );
}
