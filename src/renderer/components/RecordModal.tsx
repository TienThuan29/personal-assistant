import { AionModal } from '@aionui/ui';
import { Alert, Modal } from '@arco-design/web-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmDanger } from './ui';

type Props = {
  title: ReactNode;
  visible: boolean;
  dirty: boolean;
  saving: boolean;
  error?: string | null;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
};

/** Add/edit dialog: AionModal's default Cancel / Save footer, main's error inline, asks before dropping unsaved changes; Ctrl+Enter saves. */
export function RecordModal({ title, visible, dirty, saving, error, onSave, onClose, children }: Props) {
  const { t } = useTranslation();
  const [modal, holder] = Modal.useModal();
  const close = () =>
    saving
      ? undefined // the save may still land; closing now would hide its result
      : dirty
      ? confirmDanger(modal, { title: t('discardChanges'), okText: t('discard'), onOk: onClose })
      : onClose();
  const save = () => {
    if (!saving) onSave();
  };
  return (
    <>
      {holder}
      <AionModal
        visible={visible}
        onCancel={close}
        maskClosable={!saving}
        escToExit={!saving}
        unmountOnExit // a fresh form and picker on every open
        variant='standard'
        size='medium'
        style={{ height: 'auto' }}
        header={title}
        onOk={save}
        okText={t('ui.save')}
        confirmLoading={saving}
      >
        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && !e.repeat) {
              e.preventDefault();
              save();
            }
          }}
        >
          {error && <Alert type='error' content={error} style={{ marginBottom: 16 }} />}
          {children}
        </div>
      </AionModal>
    </>
  );
}
