import { Message } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageInput } from '../../shared/types';

export const ACCEPT = ['image/png', 'image/jpeg'];
const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGES = 10;

export type Picked = { file: File; url: string };

/** Picked images with their object-URL previews; `tooManyNs` picks the over-the-cap wording (SendBox's says "per message"). */
export function useImagePicker(tooManyNs: 'common' | 'chat' = 'common') {
  const { t } = useTranslation();
  const [images, setImages] = useState<Picked[]>([]);
  const [message, holder] = Message.useMessage();

  // Revoke the previews still picked on unmount.
  const picked = useRef(images);
  useEffect(() => {
    picked.current = images;
  }, [images]);
  useEffect(() => () => picked.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  /** `kept` = the record's existing images still attached; they count toward MAX_IMAGES too. */
  const addFiles = (files: File[], kept = 0) => {
    const ok = files.filter((f) => ACCEPT.includes(f.type) && f.size <= MAX_BYTES);
    if (ok.length < files.length) message.warning?.(t('imageRejected'));
    const room = Math.max(MAX_IMAGES - kept - images.length, 0);
    if (ok.length > room) message.warning?.(t('tooManyImages', { ns: tooManyNs, max: MAX_IMAGES }));
    const added = ok.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (added.length) setImages((prev) => [...prev, ...added]);
  };
  const removeImage = (url: string) => {
    URL.revokeObjectURL(url);
    setImages((prev) => prev.filter((i) => i.url !== url));
  };
  /** Drops `only` (default: all), keeping any picked since. */
  const clear = (only = images) => {
    only.forEach((i) => URL.revokeObjectURL(i.url));
    setImages((prev) => prev.filter((i) => !only.includes(i)));
  };
  const toInputs = (): Promise<ImageInput[]> =>
    Promise.all(images.map(async ({ file }) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));

  return { images, addFiles, removeImage, clear, toInputs, message, holder };
}
