import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UpdateStatus } from '../../shared/types';
import { Btn, ICON } from './ui';

/** "Version X is available": download or install it, or skip it. The bar fills while the app updates itself. */
export function UpdateBanner({
  update,
  percent,
  onInstall,
  onSkip,
}: {
  update: UpdateStatus;
  percent: number | null;
  onInstall: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const busy = percent !== null;
  return (
    <div className='relative flex flex-wrap items-center gap-3 mr-2 mb-2 py-2 pr-2 pl-3.5 overflow-hidden rounded-[10px] bg-accent-soft border border-solid border-accent-line'>
      <span aria-hidden className='flex text-base text-accent'>
        <Download {...ICON} />
      </span>
      <div className='flex-1 min-w-0 text-[13px] truncate'>
        <b className='font-600'>{t('update.banner', { latest: update.latest ?? '', current: update.current })}</b>
      </div>
      {!busy && (
        <>
          <Btn variant='quiet' size='sm' onClick={onSkip}>
            {t('update.skip')}
          </Btn>
          <Btn variant='primary' size='sm' onClick={update.canInstall ? onInstall : () => window.open(update.url ?? undefined)}>
            {update.canInstall ? t(update.manualInstall ? 'update.installManual' : 'update.install') : t('update.download')}
          </Btn>
        </>
      )}
      {busy && (
        <>
          <span className='font-mono text-xs text-ink-2 pr-1.5'>{t('update.downloading', { percent })}</span>
          <div className='absolute left-0 bottom-0 h-0.5 bg-accent transition-[width] duration-[160ms] linear' style={{ width: `${percent}%` }} />
        </>
      )}
    </div>
  );
}
