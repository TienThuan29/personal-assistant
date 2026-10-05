import { CalendarDays, Check, Shield, Sun, Wallet } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Theme } from '../../shared/types';
import { api, useUiSettings } from '../api';
import logo from '../assets/logo.png';
import { COMMANDS } from '../chat/SendBox';
import { shortcutLabel } from '../shortcuts';
import { AccentPicker } from './AccentPicker';
import { ModelForm, useModelForm } from './ModelForm';
import { Btn, ICON, Kbd, Segmented } from './ui';

const CMD_ICON: Record<(typeof COMMANDS)[number], ReactNode> = { homnay: <Sun {...ICON} />, tuannay: <CalendarDays {...ICON} />, chitieu: <Wallet {...ICON} /> };

/** The setup guide (design: Welcome): make it yours, connect a model, try something. Shown on a first run, reopened from Settings and ⌘K. */
export function Welcome({ onClose, onTry }: { onClose: () => void; onTry: (prompt: string) => void }) {
  const { t } = useTranslation(['shell', 'settings', 'chat']);
  const ui = useUiSettings();
  const mac = api.platform === 'darwin';
  const [step, setStep] = useState(0);
  const model = useModelForm();
  const steps = [t('shell:wStep1'), t('shell:wStep2'), t('shell:wStep3')];
  const setUi = (patch: Partial<typeof ui>) => void api.settings.setUi(patch).catch(() => {});

  return (
    <div className='absolute inset-0 z-[1600] grid place-items-center p-6 bg-chrome'>
      <div
        role='dialog'
        aria-modal='true'
        aria-label={t('shell:wTitle')}
        className='w-[min(760px,100%)] grid [grid-template-columns:230px_minmax(0,1fr)] overflow-hidden bg-panel border border-solid border-line rounded-[18px] shadow-lg'
        style={{ animation: 'pa-pop .3s ease-out' }}
      >
        <div className='flex flex-col gap-[22px] px-[22px] py-7 bg-sunken border-r border-r-solid border-line'>
          <img src={logo} alt='' className='w-12 h-12 rounded-xl shadow-sm' />
          <ol className='m-0 p-0 list-none flex flex-col gap-3.5'>
            {steps.map((label, i) => (
              <li key={label} className='flex items-center gap-2.5' aria-current={i === step ? 'step' : undefined}>
                <span className={`grid place-items-center w-6 h-6 rounded-full text-xs font-600 ${i < step ? 'bg-ok text-accent-on' : i === step ? 'bg-accent text-accent-on' : 'bg-pill text-ink-3'}`}>
                  {i < step ? <Check {...ICON} strokeWidth={3} /> : i + 1}
                </span>
                <span className={`text-[13px] font-500 ${i === step ? 'text-ink' : 'text-ink-3'}`}>{label}</span>
              </li>
            ))}
          </ol>
          <span className='flex-1' />
          <button type='button' onClick={onClose} className='self-start p-0 border-0 bg-transparent text-ink-3 text-[12.5px] cursor-pointer hover:text-ink'>
            {t('shell:wSkip')}
          </button>
        </div>
        <div className='flex flex-col gap-5 px-8 pt-8 pb-6 min-h-[440px]'>
          {step === 0 && (
            <>
              <div>
                <h2 className='m-0 mb-2 text-[26px] font-600 tracking-[-0.025em]'>{t('shell:wTitle')}</h2>
                <p className='m-0 text-ink-2 leading-relaxed'>{t('shell:wSub')}</p>
              </div>
              <div className='flex flex-col gap-2'>
                <span className='text-[12.5px] font-500 text-ink-2'>{t('settings:language')}</span>
                <Segmented className='self-start' label={t('settings:language')} value={ui.language} onChange={(language) => setUi({ language })} options={[{ value: 'vi', label: t('settings:langVi') }, { value: 'en', label: t('settings:langEn') }]} />
              </div>
              <div className='flex flex-col gap-2'>
                <span className='text-[12.5px] font-500 text-ink-2'>{t('settings:appearance')}</span>
                <Segmented<Theme>
                  className='self-start'
                  label={t('settings:appearance')}
                  value={ui.theme}
                  onChange={(theme) => setUi({ theme })}
                  options={[{ value: 'system', label: t('settings:themeSystem') }, { value: 'light', label: t('settings:themeLight') }, { value: 'dark', label: t('settings:themeDark') }]}
                />
              </div>
              <div className='flex flex-col gap-2.5'>
                <span className='text-[12.5px] font-500 text-ink-2'>{t('settings:accent')}</span>
                <AccentPicker value={ui.accent} onPick={(accent) => setUi({ accent })} />
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div>
                <h2 className='m-0 mb-2 text-2xl font-600 tracking-[-0.02em]'>{t('shell:wStep2')}</h2>
                <p className='m-0 text-ink-2 leading-relaxed'>{t('settings:providerDesc')}</p>
              </div>
              <ModelForm m={model} compact />
              <div className='flex gap-2 text-xs text-ink-2 leading-normal'>
                <span aria-hidden className='flex mt-0.5 text-ok'>
                  <Shield {...ICON} />
                </span>
                {t('shell:ctxLocal')}
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div>
                <h2 className='m-0 mb-2 text-[26px] font-600 tracking-[-0.025em]'>{t('shell:wStep3Title')}</h2>
                <p className='m-0 text-ink-2'>{t('shell:wStep3Sub')}</p>
              </div>
              <div className='flex flex-col gap-2'>
                {COMMANDS.map((key) => (
                  <button
                    key={key}
                    type='button'
                    onClick={() => (onClose(), onTry(t(`chat:cmd.${key}.prompt`)))}
                    className='flex items-center gap-3 px-3.5 py-3 border border-solid border-line rounded-xl bg-panel text-left cursor-pointer hover:border-accent-line'
                  >
                    <span aria-hidden className='flex text-[17px] text-accent'>{CMD_ICON[key]}</span>
                    <span className='flex-1 font-500 text-[13.5px]'>{t(`chat:cmd.${key}.description`)}</span>
                    <code className='font-mono text-[11.5px] font-500 text-ink-3'>/{key}</code>
                  </button>
                ))}
              </div>
              <div className='flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-2'>
                <span><Kbd className='px-[5px] py-px border border-solid border-line rounded'>{shortcutLabel('K', mac)}</Kbd> {t('shell:kPalette')}</span>
                <span><Kbd className='px-[5px] py-px border border-solid border-line rounded'>{shortcutLabel('J', mac)}</Kbd> {t('shell:kCapture')}</span>
                <span><Kbd className='px-[5px] py-px border border-solid border-line rounded'>{shortcutLabel('N', mac)}</Kbd> {t('shell:kNew')}</span>
              </div>
            </>
          )}
          <span className='flex-1' />
          <div className='flex items-center gap-2'>
            <span className='flex-1' />
            {step > 0 && (
              <Btn variant='quiet' onClick={() => setStep(step - 1)}>
                {t('shell:wBack')}
              </Btn>
            )}
            {step < 2 ? (
              <Btn variant='primary' onClick={() => setStep(step + 1)}>
                {t('shell:wNext')}
              </Btn>
            ) : (
              <Btn variant='primary' onClick={onClose}>
                {t('shell:wStart')}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
