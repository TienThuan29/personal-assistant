import { AionSelect, PreferenceRow, SectionCard, useUi } from '@aionui/ui';
import { Alert, Button, ColorPicker, Input, Message, Select, Space, Switch } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../shared/money';
import { DEFAULT_LLM, type LlmSettings, type Provider, PROVIDER_NAMES, type SettingsView, type UiSettings, type UpdateStatus } from '../../shared/types';
import { adjustAccent, applyAccent, PRESETS } from '../accent';
import { api, errorText, useUiSettings } from '../api';
import { type NotifyState, notifyState } from '../notify';

const CURRENCIES = ['VND', 'USD', 'EUR', 'JPY'];
const EXAMPLE_AMOUNT = 1_234_500; // minor units: 1.234.500 ₫ or $12,345.00
const RAINBOW = 'conic-gradient(#e5484d, #f5a524, #46a758, #0090ff, #8e4ec6, #e5484d)';
const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** 8 presets + a custom picker as one radio group. Swatches show the colour as the current theme adjusts it. */
function AccentPicker({ value, onPick }: { value: string; onPick: (accent: string) => void }) {
  const { t } = useTranslation('settings');
  const { theme } = useUi();
  const shown = (hex: string) => adjustAccent(hex, theme); // presets pass in light as is
  const swatches = useMemo(() => PRESETS.map((p) => shown(p.hex)), [theme]); // shown depends only on theme
  const custom = !PRESETS.some((p) => p.hex === value);
  const group = useRef<HTMLDivElement>(null);
  const draft = useRef(value);
  const [open, setOpen] = useState(false);

  // Dragging previews; closing saves; Esc (anywhere, also in the panel's inputs) undoes.
  const close = (undo: boolean) => {
    setOpen(false);
    if (undo) applyAccent(value);
    else if (draft.current !== value) onPick(draft.current);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close(true);
      (group.current?.lastElementChild as HTMLElement | null)?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  // Roving focus; like native radios, arrows also select (the custom swatch only takes focus).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROWS[e.key];
    if (!step || !e.currentTarget.contains(e.target as Node)) return; // not keys from the picker's portal
    e.preventDefault();
    const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')];
    const i = (radios.indexOf(e.target as HTMLElement) + step + radios.length) % radios.length;
    radios[i].focus();
    if (i < PRESETS.length) onPick(PRESETS[i].hex);
  };

  const swatch = 'size-6 shrink-0 rounded-full border-0 p-0 cursor-pointer focus-visible:outline-offset-4';
  const ring = 'outline outline-2 outline-ink outline-offset-2';
  return (
    <div ref={group} role='radiogroup' aria-label={t('accent')} className='flex flex-wrap items-center gap-2' onKeyDown={onKeyDown}>
      {PRESETS.map((p, i) => (
        <button
          key={p.key}
          type='button'
          role='radio'
          aria-checked={p.hex === value}
          aria-label={t(`accentName.${p.key}`)}
          title={t(`accentName.${p.key}`)}
          tabIndex={p.hex === value ? 0 : -1}
          className={`${swatch} ${p.hex === value ? ring : ''}`}
          style={{ background: swatches[i] }}
          onClick={() => onPick(p.hex)}
        />
      ))}
      <ColorPicker
        value={value}
        disabledAlpha
        format='hex'
        popupVisible={open}
        triggerProps={{ position: 'br' }} // the swatch ends the row, at the window's right edge
        onVisibleChange={(v) => {
          if (!v) return close(false);
          draft.current = value;
          setOpen(true);
        }}
        onChange={(v) => {
          draft.current = String(v).toLowerCase();
          applyAccent(draft.current);
        }}
        triggerElement={
          <button
            type='button'
            role='radio'
            aria-checked={custom}
            aria-label={t('accentCustom')}
            title={t('accentCustom')}
            tabIndex={custom ? 0 : -1}
            className={`${swatch} ${custom ? ring : ''}`}
            style={{ background: custom ? shown(value) : RAINBOW }}
          />
        }
      />
    </div>
  );
}

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
      <PreferenceRow label={t('accent')} description={t('accentDesc')}>
        <AccentPicker
          value={ui.accent}
          onPick={(accent) =>
            void api.settings.setUi({ accent }).catch((e) => {
              applyAccent(ui.accent); // drop the picker's preview
              message.error?.(errorText(e));
            })
          }
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

/** The version in use, a manual check (always asks GitHub, tells the user when it cannot) and the automatic-check switch. */
function UpdateCard({ version }: { version: string }) {
  const { t } = useTranslation('settings');
  const ui = useUiSettings();
  const [message, messageHolder] = Message.useMessage();
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<UpdateStatus | null>(null);
  const check = () => {
    setChecking(true);
    api.update
      .check(true)
      .then(setFound, (e) => message.error?.(errorText(e)))
      .finally(() => setChecking(false));
  };
  return (
    <SectionCard title={t('updates')}>
      {messageHolder}
      <PreferenceRow label={t('version')} description={t('versionDesc', { version })}>
        <Space>
          <Button loading={checking} onClick={check}>
            {t('checkNow')}
          </Button>
          {found &&
            (found.latest ? (
              <Button type='text' onClick={() => window.open(found.url ?? undefined)}>
                {t('available', { version: found.latest })}
              </Button>
            ) : (
              <span role='status'>{t('upToDate')}</span>
            ))}
        </Space>
      </PreferenceRow>
      <PreferenceRow label={t('autoCheck')} description={t('autoCheckDesc')}>
        <Switch
          aria-label={t('autoCheck')}
          checked={ui.checkUpdates}
          onChange={(checkUpdates: boolean) => void api.settings.setUi({ checkUpdates }).catch((e) => message.error?.(errorText(e)))}
        />
      </PreferenceRow>
    </SectionCard>
  );
}

/** Docker mode: reminders come as browser notifications, which the browser only allows after a click here. */
function BrowserNotifications() {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<NotifyState>(notifyState());
  return (
    <PreferenceRow label={t('browserNotifications')} description={t('browserNotificationsDesc')}>
      <Space>
        <span>{t(`notifyState.${state}`)}</span>
        {state === 'default' && (
          <Button size='small' onClick={() => void Notification.requestPermission().then(() => setState(notifyState()))}>
            {t('notifyEnable')}
          </Button>
        )}
      </Space>
    </PreferenceRow>
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
      <UpdateCard version={view.version} />
      <SectionCard title={t('system')}>
        {api.web ? (
          <BrowserNotifications />
        ) : (
          <PreferenceRow label={t('openAtLogin')} description={t('openAtLoginDesc')}>
            <Switch
              aria-label={t('openAtLogin')}
              checked={openAtLogin}
              onChange={(on: boolean) =>
                api.settings.setOpenAtLogin(on).then(setOpenAtLogin, (e) => report('error', errorText(e)))
              }
            />
          </PreferenceRow>
        )}
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
