import { FilePreview } from '@aionui/ui';
import { Button } from '@arco-design/web-react';
import { Close, Pic, Undo } from '@icon-park/react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { attUrl } from '../api';
import { ACCEPT, type useImagePicker } from './useImagePicker';

type Props = {
  existing: string[];
  removed: string[];
  onToggleRemove: (id: string) => void;
  picker: ReturnType<typeof useImagePicker>;
};

/** A record's images: kept ones toggle a removal mark (applied on save), new ones come from the picker; accepts paste and drop. */
export function ImageField({ existing, removed, onToggleRemove, picker }: Props) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div
      className='image-field'
      tabIndex={0}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        picker.addFiles(Array.from(e.dataTransfer.files));
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length) {
          e.preventDefault();
          picker.addFiles(files);
        }
      }}
    >
      {picker.holder}
      {(existing.length > 0 || picker.images.length > 0) && (
        <div className='thumbs'>
          {existing.map((id) => {
            const off = removed.includes(id);
            return (
              <div key={id} className={off ? 'field-thumb is-removed' : 'field-thumb'}>
                <img src={attUrl(id)} alt={t('attachment')} />
                <button type='button' aria-label={t(off ? 'undoRemove' : 'removeImage')} title={t(off ? 'undoRemove' : 'removeImage')} onClick={() => onToggleRemove(id)}>
                  {off ? <Undo /> : <Close />}
                </button>
              </div>
            );
          })}
          {picker.images.map((img, i) => (
            <FilePreview key={img.url} path={img.file.name || 'image.png'} size={img.file.size} imageSrc={img.url} onRemove={() => picker.removeImage(i)} />
          ))}
        </div>
      )}
      <Button type='text' size='small' icon={<Pic />} onClick={() => fileInput.current?.click()}>
        {t('addImage')}
      </Button>
      <input
        ref={fileInput}
        type='file'
        accept={ACCEPT.join(',')}
        multiple
        hidden
        onChange={(e) => {
          picker.addFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}
