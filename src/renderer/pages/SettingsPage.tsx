import { Message, Select } from '@arco-design/web-react';
import { Cpu, FolderOpen, Keyboard, Palette, Power, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../shared/money';
import type { Theme, UiSettings, UpdateStatus } from '../../shared/types';
import { applyAccent } from '../accent';
import { api, errorText, useUiSettings } from '../api';
import { AccentPicker } from '../components/AccentPicker';
import { ModelForm, useModelForm } from '../components/ModelForm';
import { Btn, ICON, Kbd, Segmented, SettingRow, Toggle } from '../components/ui';
import { type NotifyState, notifyState } from '../notify';
import { shortcutLabel } from '../shortcuts';

const CURRENCIES = ['VND', 'USD', 'EUR', 'JPY'];
const EXAMPLE_AMOUNT = 1_234_500; // minor units: 1.234.500 ₫ or $12,345.00

type Section = 'display' | 'model' | 'updates' | 'system' | 'keys';
const SECTIONS: { key: Section; icon: React.ReactNode }[] = [
  { key: 'display', icon: <Palette {...ICON} /> },
  { key: 'model', icon: <Cpu {...ICON} /> },
  { key: 'updates', icon: <RefreshCw {...ICON} /> },
  { key: 'system', icon: <Power {...ICON} /> },
  { key: 'keys', icon: <Keyboard {...ICON} /> },
];

/** Applied at once; main broadcasts ui:changed, which updates the language, the theme, the accent and the context (main.tsx). */
function Display() {
  const { t } = useTranslation('settings');
  const ui = useUiSettings();
  const [message, messageHolder] = Message.useMessage();
  const setUi = (patch: Partial<UiSettings>) => void api.settings.setUi(patch).catch((e) => message.error?.(errorText(e)));
  const example = (style: UiSettings['moneyStyle']) => formatMoney(EXAMPLE_AMOUNT, ui.defaultCurrency, style);
  return (
    <div className='flex flex-col'>
      {messageHolder}
      <SettingRow label={t('language')} desc={t('languageDesc')}>
        <Segmented
          label={t('language')}
          value={ui.language}
          onChange={(language) => setUi({ language })}
          options={[
            { value: 'vi', label: t('langVi') },
            { value: 'en', label: t('langEn') },
          ]}
        />
      </SettingRow>
      <SettingRow label={t('appearance')} desc={t('appearanceDesc')}>
        <Segmented<Theme>
          label={t('appearance')}
          value={ui.theme}
          onChange={(theme) => setUi({ theme })}
          options={[
            { value: 'system', label: t('themeSystem') },
            { value: 'light', label: t('themeLight') },
            { value: 'dark', label: t('themeDark') },
          ]}
        />
      </SettingRow>
      <SettingRow label={t('accent')} desc={t('accentDesc')}>
        <AccentPicker
          value={ui.accent}
          onPick={(accent) =>
            void api.settings.setUi({ accent }).catch((e) => {
              applyAccent(ui.accent); // drop the picker's preview
              message.error?.(errorText(e));
            })
          }
        />
      </SettingRow>
      <SettingRow label={t('moneyStyle')} desc={t('moneyStyleDesc')}>
        <Segmented
          label={t('moneyStyle')}
          value={ui.moneyStyle}
          onChange={(moneyStyle) => setUi({ moneyStyle })}
          options={[
            { value: 'vi', label: t('moneyVi', { example: example('vi') }) },
            { value: 'intl', label: t('moneyIntl', { example: example('intl') }) },
          ]}
        />
      </SettingRow>
      <SettingRow label={t('defaultCurrency')} desc={t('defaultCurrencyDesc')} last>
        {/* allowCreate: type any other 3-letter ISO code (anything else is ignored); main validates it and a bad one shows as a message. */}
        <Select
          aria-label={t('defaultCurrency')}
          value={ui.defaultCurrency}
          showSearch
          allowCreate
          onChange={(defaultCurrency: string) => /^[A-Za-z]{3}$/.test(defaultCurrency) && setUi({ defaultCurrency })}
          style={{ width: 160 }}
          options={[...new Set([...CURRENCIES, ui.defaultCurrency])]}
        />
      </SettingRow>
    </div>
  );
}

/** The version in use, a manual check (always asks GitHub, tells the user when it cannot) and the automatic-check switch. */
function Updates({ version }: { version: string }) {
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
    <div className='flex flex-col'>
      {messageHolder}
      <SettingRow label={t('version')} desc={t('versionDesc', { version })}>
        {found &&
          (found.latest ? (
            <button type='button' onClick={() => window.open(found.url ?? undefined)} className='border-0 bg-transparent text-accent text-[12.5px] font-500 cursor-pointer'>
              {t('available', { version: found.latest })}
            </button>
          ) : (
            <span role='status' className='text-[12.5px] text-ink-2'>
              {t('upToDate')}
            </span>
          ))}
        <Btn size='sm' disabled={checking} onClick={check}>
          {checking ? t('checking') : t('checkNow')}
        </Btn>
      </SettingRow>
      <SettingRow label={t('autoCheck')} desc={t('autoCheckDesc')} last>
        <Toggle label={t('autoCheck')} checked={ui.checkUpdates} onChange={(checkUpdates) => void api.settings.setUi({ checkUpdates }).catch((e) => message.error?.(errorText(e)))} />
      </SettingRow>
    </div>
  );
}

/** Docker mode: reminders come as browser notifications, which the browser only allows after a click here. */
function BrowserNotifications() {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<NotifyState>(notifyState());
  return (
    <SettingRow label={t('browserNotifications')} desc={t('browserNotificationsDesc')}>
      <span className='text-[12.5px] text-ink-2'>{t(`notifyState.${state}`)}</span>
      {state === 'default' && (
        <Btn size='sm' onClick={() => void Notification.requestPermission().then(() => setState(notifyState()))}>
          {t('notifyEnable')}
        </Btn>
      )}
    </SettingRow>
  );
}

function System({ openAtLogin, setOpenAtLogin, onWelcome }: { openAtLogin: boolean; setOpenAtLogin: (on: boolean) => void; onWelcome: () => void }) {
  const { t } = useTranslation('settings');
  const [message, messageHolder] = Message.useMessage();
  const [path, setPath] = useState('');
  useEffect(() => {
    if (!api.web) api.settings.dataPath().then(setPath, () => {}); // the browser has no data folder to show
  }, []);
  return (
    <div className='flex flex-col'>
      {messageHolder}
      {api.web ? (
        <BrowserNotifications />
      ) : (
        <>
        <SettingRow label={t('openAtLogin')} desc={t('openAtLoginDesc')}>
          <Toggle label={t('openAtLogin')} checked={openAtLogin} onChange={(on) => api.settings.setOpenAtLogin(on).then(setOpenAtLogin, (e) => message.error?.(errorText(e)))} />
        </SettingRow>
        <SettingRow stacked label={t('dataFolder')} desc={t('dataFolderDesc')}>
          <div className='flex items-center gap-2'>
            <code className='flex-1 min-w-0 px-3 py-2 rounded-lg bg-sunken border border-solid border-line font-mono text-[12.5px] truncate'>{path}</code>
            <Btn icon={<FolderOpen {...ICON} />} onClick={() => api.settings.revealData().catch((e) => message.error?.(errorText(e)))}>
              {t('revealData')}
            </Btn>
          </div>
        </SettingRow>
        </>
      )}
      <SettingRow label={t('setup')} desc={t('setupDesc')} last>
        <Btn size='sm' onClick={onWelcome}>
          {t('runSetup')}
        </Btn>
      </SettingRow>
    </div>
  );
}

function Shortcuts() {
  const { t } = useTranslation('settings');
  const mac = api.platform === 'darwin';
  const k = (x: string) => shortcutLabel(x, mac);
  const keys: [string, string][] = [
    [k('K'), t('kPalette')],
    [k('J'), t('kCapture')],
    [k('N'), t('kNew')],
    [`${k('1')}–5`, t('kPages')],
    [k(','), t('kSettings')],
    [k('B'), t('kSidebar')],
    ['Enter', t('kSend')],
    ['Shift+Enter', t('kNewline')],
  ];
  return (
    <div className='mt-2 border border-solid border-line rounded-card overflow-hidden'>
      {keys.map(([key, label]) => (
        <div key={key} className='flex items-center gap-4 px-4 py-3 border-b border-b-solid border-line last:border-b-0'>
          <span className='flex-1 text-[13.5px]'>{label}</span>
          <Kbd className='!text-ink px-2 py-[3px] rounded-md border border-solid border-line !border-b-2 bg-sunken !text-xs'>{key}</Kbd>
        </div>
      ))}
    </div>
  );
}

export function SettingsPage({ onWelcome }: { onWelcome: () => void }) {
  const { t } = useTranslation('settings');
  const [section, setSection] = useState<Section>('display');
  const model = useModelForm();
  const [openAtLogin, setOpenAtLogin] = useState(false);
  useEffect(() => {
    if (model.view) setOpenAtLogin(model.view.openAtLogin);
  }, [model.view]);

  return (
    <div className='flex-1 min-w-0 grid [grid-template-columns:minmax(170px,210px)_minmax(0,1fr)]'>
      <div className='flex flex-col gap-0.5 px-3 py-6 bg-sunken border-r border-r-solid border-line'>
        <h1 className='mx-2.5 mt-0 mb-3.5 text-lg font-600'>{t('title')}</h1>
        {SECTIONS.map((s) => {
          const on = s.key === section;
          return (
            <button
              key={s.key}
              type='button'
              aria-current={on ? 'page' : undefined}
              onClick={() => setSection(s.key)}
              className={`h-[34px] flex items-center gap-2.5 px-2.5 border-0 rounded-lg text-[13.5px] font-500 text-left cursor-pointer ${on ? 'bg-accent-soft text-ink' : 'bg-transparent text-ink-2 hover:text-ink'}`}
            >
              <span aria-hidden className={`flex text-base ${on ? 'text-accent' : ''}`}>{s.icon}</span>
              {t(`section.${s.key}`)}
            </button>
          );
        })}
      </div>
      <div className='overflow-y-auto' style={{ scrollbarGutter: 'stable' }}>
        <div className='max-w-[720px] px-11 pt-8 pb-14 flex flex-col'>
          <h2 className='m-0 mb-2 text-[22px] font-600 tracking-[-0.015em]'>{t(`section.${section}`)}</h2>
          {section === 'display' && <Display />}
          {section === 'model' && <ModelForm m={model} />}
          {section === 'updates' && <Updates version={model.view?.version ?? ''} />}
          {section === 'system' && <System openAtLogin={openAtLogin} setOpenAtLogin={setOpenAtLogin} onWelcome={onWelcome} />}
          {section === 'keys' && <Shortcuts />}
        </div>
      </div>
    </div>
  );
}
