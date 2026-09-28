import { AionSelect, PreferenceRow, SectionCard, SettingsPageHeader } from '@aionui/ui';
import { Alert, Button, Input, Message, Select, Space, Switch } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../shared/money';
import { DEFAULT_LLM, type LlmConfig, type SettingsView, type UiSettings } from '../../shared/types';
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
        {/* allowCreate: type any other ISO code; main validates it and a bad one shows as a message. */}
        <Select
          aria-label={t('defaultCurrency')}
          value={ui.defaultCurrency}
          showSearch
          allowCreate
          onChange={(defaultCurrency: string) => defaultCurrency && setUi({ defaultCurrency })}
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
  const [llm, setLlm] = useState<LlmConfig>(DEFAULT_LLM);
  const [apiKey, setApiKey] = useState('');
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

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

  const set = (patch: Partial<LlmConfig>) => setLlm((l) => ({ ...l, ...patch }));
  const save = async () => {
    await api.settings.save({ llm, apiKey: apiKey || undefined });
    setApiKey('');
    setView(await api.settings.get());
  };
  const run = (kind: 'save' | 'test', fn: () => Promise<string>) => async () => {
    setBusy(kind);
    setStatus(null);
    try {
      setStatus({ type: 'success', text: await fn() });
    } catch (e) {
      setStatus({ type: 'error', text: errorText(e) });
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
  const azure = llm.provider === 'azure';
  const keyLabel = azure ? 'API key' : 'Access token';
  return (
    <div className='page settings'>
      <SettingsPageHeader title={t('title')} sticky={false} />
      <DisplayCard />
      <SectionCard title={t('model')}>
        <PreferenceRow label={t('provider')} description={t('providerDesc')}>
          <AionSelect
            aria-label={t('provider')}
            value={llm.provider}
            onChange={(v: LlmConfig['provider']) => {
              set({ provider: v });
              setApiKey('');
            }}
            style={{ width: 380 }}
            options={[
              { label: 'Azure AI Foundry', value: 'azure' },
              { label: 'LLM gateway', value: 'gateway' },
            ]}
          />
        </PreferenceRow>
        <PreferenceRow label='Endpoint' description={azure ? t('endpointAzure') : t('endpointGateway')}>
          <Input aria-label='Endpoint' placeholder='https://…' value={llm.endpoint} onChange={(v) => set({ endpoint: v })} style={{ width: 380 }} />
        </PreferenceRow>
        <PreferenceRow label={azure ? 'Deployment' : 'Model'} description={t('modelDesc')}>
          <Input
            aria-label={azure ? 'Deployment' : 'Model'}
            placeholder={t('modelPlaceholder')}
            value={llm.model}
            onChange={(v) => set({ model: v })}
            style={{ width: 380 }}
          />
        </PreferenceRow>
        {azure && (
          <PreferenceRow label='API version'>
            <Input aria-label='API version' value={llm.apiVersion} onChange={(v) => set({ apiVersion: v })} style={{ width: 380 }} />
          </PreferenceRow>
        )}
        <PreferenceRow
          label={keyLabel}
          description={view.hasKey[llm.provider] ? t('keySaved') : t('keyMissing')}
        >
          <Input.Password
            aria-label={keyLabel}
            placeholder={view.hasKey[llm.provider] ? t('keySavedPlaceholder') : undefined}
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
              api.settings.setOpenAtLogin(on).then(setOpenAtLogin, (e) => setStatus({ type: 'error', text: errorText(e) }))
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
