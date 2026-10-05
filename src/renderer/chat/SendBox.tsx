import { FilePreview, SlashCommandMenu } from '@aionui/ui';
import { Button, Input, Progress, Tooltip } from '@arco-design/web-react';
import { FolderSearch, PauseOne, Pic, Send } from '@icon-park/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageInput, PdfInput } from '../../shared/types';
import { ACCEPT, useImagePicker } from '../components/useImagePicker';
import { isPdf, usePdfPicker } from '../components/usePdfPicker';

/** Slash commands are just canned prompts; the names stay the same in every language. */
export const COMMANDS = ['homnay', 'tuannay', 'chitieu'] as const;

type Props = {
  running: boolean;
  /** `files`: file search is on for this message (docs/file-search-design.md). `document`: a PDF already drawn to page images. */
  onSend: (text: string, images: ImageInput[], files: boolean, document?: PdfInput) => Promise<boolean>;
  onStop: () => void;
  autoFocus?: boolean;
};

export function SendBox({ running, onSend, onStop, autoFocus }: Props) {
  const { t } = useTranslation('chat');
  const commands = COMMANDS.map((key) => ({ key, label: `/${key}`, description: t(`cmd.${key}.description`), prompt: t(`cmd.${key}.prompt`) }));
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null); // the text the slash menu was closed on (Escape)
  const [files, setFiles] = useState(false); // file search for the next message only; off again once it is sent
  const fileInput = useRef<HTMLInputElement>(null);
  const { images, addFiles, removeImage, clear, toInputs, message, holder: messageHolder } = useImagePicker('chat');
  const { pdf, pick: pickPdf, clear: clearPdf, toInput: pdfInput } = usePdfPicker((p) => message.error?.(t(p.key, p.params)));

  /** Images and one PDF can't share a message (docs/pdf-batch-reasoning-design.md P10). */
  const onFiles = (list: File[]) => {
    const pdfs = list.filter(isPdf);
    const rest = list.filter((f) => !isPdf(f));
    if (!pdfs.length) {
      if (pdf && rest.length) return void message.warning?.(t('pdfWithImages'));
      return addFiles(rest);
    }
    if (images.length || rest.length) return void message.warning?.(t('pdfWithImages'));
    if (pdfs.length > 1) message.warning?.(t('onePdf'));
    void pickPdf(pdfs[0]);
  };

  const slash = /^\/\S*$/.test(text) && text !== dismissed ? commands.filter((c) => c.label.startsWith(text)) : [];
  useEffect(() => setActive(0), [text]);

  /** Clears the input only once main has accepted the message, so a failed send loses nothing. */
  const submit = async (value = text) => {
    if (running || sending || (!value.trim() && !images.length && !pdf)) return;
    if (pdf && !pdf.ready) return void message.info?.(t('pdfStillReading'));
    setSending(true);
    const typed = text;
    try {
      const sent = images;
      const payload = await toInputs();
      const document = pdfInput() ?? undefined;
      if (!(await onSend(value.trim(), payload, files, document))) return;
      setFiles(false);
      setText((t) => (t === typed ? '' : t)); // keep anything typed while sending
      clear(sent); // keep any picked while sending
      if (document) clearPdf();
    } catch {
      message.error?.(t('imageReadFailed'));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // IME (Telex/VNI) is still composing
    if (slash.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : slash.length - 1)) % slash.length);
      return;
    }
    if (slash.length && e.key === 'Escape') {
      e.preventDefault();
      setDismissed(text);
      return;
    }
    if (slash.length && e.key === 'Tab') {
      e.preventDefault();
      setText(slash[Math.min(active, slash.length - 1)].label);
      return;
    }
    if (slash.length && e.key === 'Enter') {
      e.preventDefault();
      void submit(slash[Math.min(active, slash.length - 1)].prompt);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className='sendbox'
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {messageHolder}
      {slash.length > 0 && (
        <div className='slash-menu'>
          <SlashCommandMenu
            title={t('slashTitle')}
            hint={t('slashHint')}
            items={slash}
            activeIndex={Math.min(active, slash.length - 1)}
            onHoverItem={setActive}
            onSelectItem={(item) => void submit(commands.find((c) => c.key === item.key)!.prompt)}
            emptyText={t('slashEmpty')}
          />
        </div>
      )}
      <div className='sendbox-inner'>
        {images.length > 0 && (
          <div className='thumbs'>
            {images.map((img) => (
              <FilePreview key={img.url} path={img.file.name || 'image.png'} size={img.file.size} imageSrc={img.url} onRemove={() => removeImage(img.url)} />
            ))}
          </div>
        )}
        {pdf && (
          <div className='thumbs' style={{ alignItems: 'center' }}>
            <FilePreview path={pdf.name} size={pdf.size} onRemove={clearPdf} />
            <div className='text-xs text-ink-2' style={{ minWidth: 160 }}>
              {pdf.ready ? t('pdfReady', { count: pdf.pages }) : t('pdfReading', { done: pdf.done, total: pdf.pages || '…' })}
              {!pdf.ready && pdf.pages > 0 && <Progress percent={Math.round((pdf.done / pdf.pages) * 100)} size='small' showText={false} />}
            </div>
          </div>
        )}
        <Input.TextArea
          value={text}
          onChange={(v) => {
            setText(v);
            setDismissed(null);
          }}
          aria-label={t('inputLabel')}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length && !e.clipboardData.getData('text/plain')) {
              e.preventDefault();
              onFiles(files);
            }
          }}
          autoSize={{ minRows: 2, maxRows: 8 }}
          placeholder={t(files ? 'fileSearchOn' : 'placeholder')}
        />
        <div className='sendbox-actions'>
          <Tooltip content={t('attachImage')}>
            <Button type='text' icon={<Pic />} aria-label={t('attachImage')} onClick={() => fileInput.current?.click()} />
          </Tooltip>
          <Tooltip content={t('fileSearch')}>
            <Button
              type='text'
              icon={<FolderSearch />}
              aria-label={t('fileSearch')}
              aria-pressed={files}
              className={`mr-auto ${files ? '!text-accent !bg-accent-soft' : ''}`} // mr-auto: next to the image button, send stays right
              onClick={() => setFiles((on) => !on)}
            />
          </Tooltip>
          <input
            ref={fileInput}
            type='file'
            accept={[...ACCEPT, 'application/pdf'].join(',')}
            multiple
            hidden
            onChange={(e) => {
              onFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          {running ? (
            <Button shape='circle' status='warning' icon={<PauseOne />} aria-label={t('stop')} onClick={onStop} />
          ) : (
            <Button shape='circle' type='primary' icon={<Send />} aria-label={t('send')} loading={sending} onClick={() => void submit()} />
          )}
        </div>
      </div>
      <div className='max-w-[760px] mx-auto mt-1.5 px-1 text-xs text-ink-2'>{t('composerHint')}</div>
    </div>
  );
}
