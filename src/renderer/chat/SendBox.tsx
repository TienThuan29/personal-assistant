import { FilePreview } from '@aionui/ui';
import { Input, Progress } from '@arco-design/web-react';
import { ArrowUp, CalendarDays, FolderSearch, Image as ImageIcon, Square, Sun, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageInput, PdfInput } from '../../shared/types';
import { ICON } from '../components/ui';
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
  /** The model in use ('gpt-4o · LLM gateway'), shown at the right of the toolbar. */
  modelLabel?: string;
};

const CMD_ICONS = { homnay: <Sun {...ICON} />, tuannay: <CalendarDays {...ICON} />, chitieu: <Wallet {...ICON} /> };

export function SendBox({ running, onSend, onStop, autoFocus, modelLabel }: Props) {
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
        <div className='slash-menu' role='listbox' aria-label={t('slashTitle')}>
          <div className='px-2 py-1.5 text-[11px] font-600 tracking-[0.04em] uppercase text-ink-3'>{t('slashTitle')}</div>
          {slash.map((item, i) => (
            <button
              key={item.key}
              type='button'
              role='option'
              aria-selected={i === Math.min(active, slash.length - 1)}
              onMouseMove={() => setActive(i)}
              onClick={() => void submit(item.prompt)}
              className={`w-full flex items-center gap-2.5 p-2 border-0 rounded-lg text-left cursor-pointer ${i === Math.min(active, slash.length - 1) ? 'bg-accent-soft' : 'bg-transparent'}`}
            >
              <span aria-hidden className='flex text-accent'>{CMD_ICONS[item.key]}</span>
              <code className='font-mono text-[12.5px] font-500'>{item.label}</code>
              <span className='text-[13px] text-ink-2'>{item.description}</span>
            </button>
          ))}
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
          <button
            type='button'
            aria-label={t('attachImage')}
            title={t('attachImage')}
            onClick={() => fileInput.current?.click()}
            className='grid place-items-center w-[30px] h-[30px] border-0 rounded-lg bg-transparent text-ink-2 text-base cursor-pointer hover:bg-hover hover:text-ink'
          >
            <ImageIcon {...ICON} />
          </button>
          <button
            type='button'
            aria-pressed={files}
            title={t('fileSearch')}
            onClick={() => setFiles((on) => !on)}
            className={`flex items-center gap-1.5 h-[30px] px-[9px] border-0 rounded-lg text-[12.5px] font-500 cursor-pointer ${files ? 'bg-accent-soft text-accent' : 'bg-transparent text-ink-2 hover:bg-hover hover:text-ink'}`}
          >
            <FolderSearch {...ICON} />
            {t('fileSearchShort')}
          </button>
          <span className='flex-1' />
          {modelLabel && <span className='pr-1.5 text-[11.5px] text-ink-3 truncate'>{modelLabel}</span>}
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
            <button type='button' aria-label={t('stop')} title={t('stop')} onClick={onStop} className='grid place-items-center w-8 h-8 border-0 rounded-full bg-ink text-panel text-[11px] cursor-pointer'>
              <Square {...ICON} fill='currentColor' />
            </button>
          ) : (
            <button
              type='button'
              aria-label={t('send')}
              title={t('send')}
              disabled={sending || (!text.trim() && !images.length && !pdf)}
              onClick={() => void submit()}
              className={`grid place-items-center w-8 h-8 border-0 rounded-full text-base transition-colors ${text.trim() || images.length || pdf ? 'bg-accent text-accent-on cursor-pointer' : 'bg-pill text-ink-3 cursor-default'}`}
            >
              <ArrowUp {...ICON} />
            </button>
          )}
        </div>
      </div>
      <div className='max-w-[760px] mx-auto mt-1.5 px-1 text-xs text-ink-2'>{t('composerHint')}</div>
    </div>
  );
}
