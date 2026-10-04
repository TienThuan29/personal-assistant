import { FilePreview, SlashCommandMenu } from '@aionui/ui';
import { Input } from '@arco-design/web-react';
import { FolderSearch, PauseOne, Pic, Send } from '@icon-park/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageInput } from '../../shared/types';
import { IconButton } from '../components/ui';
import { ACCEPT, useImagePicker } from '../components/useImagePicker';

/** Slash commands are just canned prompts; the names stay the same in every language. */
export const COMMANDS = ['homnay', 'tuannay', 'chitieu'] as const;

type Props = {
  running: boolean;
  /** `files`: file search is on for this message (docs/file-search-design.md). */
  onSend: (text: string, images: ImageInput[], files: boolean) => Promise<boolean>;
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

  const slash = /^\/\S*$/.test(text) && text !== dismissed ? commands.filter((c) => c.label.startsWith(text)) : [];
  useEffect(() => setActive(0), [text]);

  /** Clears the input only once main has accepted the message, so a failed send loses nothing. */
  const submit = async (value = text) => {
    if (running || sending || (!value.trim() && !images.length)) return;
    setSending(true);
    const typed = text;
    try {
      const sent = images;
      const payload = await toInputs();
      if (!(await onSend(value.trim(), payload, files))) return;
      setFiles(false);
      setText((t) => (t === typed ? '' : t)); // keep anything typed while sending
      clear(sent); // keep any picked while sending
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
        addFiles(Array.from(e.dataTransfer.files));
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
              addFiles(files);
            }
          }}
          autoSize={{ minRows: 2, maxRows: 8 }}
          placeholder={t(files ? 'fileSearchOn' : 'placeholder')}
        />
        <div className='sendbox-actions'>
          <IconButton type='text' icon={<Pic />} label={t('attachImage')} onClick={() => fileInput.current?.click()} />
          <IconButton
            type='text'
            icon={<FolderSearch />}
            label={t('fileSearch')}
            aria-pressed={files}
            className={`mr-auto ${files ? '!text-accent !bg-accent-soft' : ''}`} // mr-auto: next to the image button, send stays right
            onClick={() => setFiles((on) => !on)}
          />
          <input
            ref={fileInput}
            type='file'
            accept={ACCEPT.join(',')}
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          {running ? (
            <IconButton shape='circle' status='warning' icon={<PauseOne />} label={t('stop')} onClick={onStop} />
          ) : (
            <IconButton shape='circle' type='primary' icon={<Send />} label={t('send')} loading={sending} onClick={() => void submit()} />
          )}
        </div>
      </div>
      <div className='max-w-[760px] mx-auto mt-1.5 px-1 text-xs text-ink-2'>{t('composerHint')}</div>
    </div>
  );
}
