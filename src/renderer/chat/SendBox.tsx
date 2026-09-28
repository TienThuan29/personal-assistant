import { FilePreview, SlashCommandMenu } from '@aionui/ui';
import { Button, Input, Message } from '@arco-design/web-react';
import { PauseOne, Pic, Send } from '@icon-park/react';
import { useEffect, useRef, useState } from 'react';
import type { ImageInput } from '../../shared/types';

const ACCEPT = ['image/png', 'image/jpeg'];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 10;

/** Slash commands are just canned prompts. */
const COMMANDS = [
  { key: 'homnay', label: '/homnay', description: 'Tóm tắt hôm nay', prompt: 'Hôm nay tôi có những việc gì? Tóm tắt task hôm nay, task quá hạn, nhắc nhở và chi tiêu hôm nay.' },
  { key: 'tuannay', label: '/tuannay', description: 'Task tuần này', prompt: 'Tuần này (thứ 2 đến chủ nhật) tôi có những task nào? Nhóm theo ngày.' },
  { key: 'chitieu', label: '/chitieu', description: 'Chi tiêu tháng này', prompt: 'Tổng hợp chi tiêu tháng này theo từng danh mục và so với tháng trước.' },
];

type Picked = { file: File; url: string };

type Props = { running: boolean; onSend: (text: string, images: ImageInput[]) => Promise<boolean>; onStop: () => void };

export function SendBox({ running, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<Picked[]>([]);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null); // the text the slash menu was closed on (Escape)
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, messageHolder] = Message.useMessage();

  const slash = /^\/\S*$/.test(text) && text !== dismissed ? COMMANDS.filter((c) => c.label.startsWith(text)) : [];
  useEffect(() => setActive(0), [text]);

  // Revoke the previews still picked when the chat closes.
  const picked = useRef(images);
  useEffect(() => {
    picked.current = images;
  }, [images]);
  useEffect(() => () => picked.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const addFiles = (files: File[]) => {
    const ok = files.filter((f) => ACCEPT.includes(f.type) && f.size <= MAX_BYTES);
    if (ok.length < files.length) message.warning?.('Chỉ nhận ảnh PNG/JPEG, tối đa 20MB');
    const room = Math.max(MAX_IMAGES - images.length, 0);
    if (ok.length > room) message.warning?.(`Tối đa ${MAX_IMAGES} ảnh mỗi tin nhắn`);
    const added = ok.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (added.length) setImages((prev) => [...prev, ...added]);
  };
  const removeImage = (i: number) =>
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });

  /** Clears the input only once main has accepted the message, so a failed send loses nothing. */
  const submit = async (value = text) => {
    if (running || sending || (!value.trim() && !images.length)) return;
    setSending(true);
    const typed = text;
    try {
      const sent = images;
      const payload = await Promise.all(sent.map(async ({ file }) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
      if (!(await onSend(value.trim(), payload))) return;
      sent.forEach((i) => URL.revokeObjectURL(i.url));
      setText((t) => (t === typed ? '' : t)); // keep anything typed while sending
      setImages((prev) => prev.filter((i) => !sent.includes(i))); // keep any picked while sending
    } catch {
      message.error?.('Không đọc được ảnh, hãy chọn lại');
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
            title='Lệnh nhanh'
            hint='↑↓ chọn · Tab điền · Enter gửi · Esc đóng'
            items={slash}
            activeIndex={Math.min(active, slash.length - 1)}
            onHoverItem={setActive}
            onSelectItem={(item) => void submit(COMMANDS.find((c) => c.key === item.key)!.prompt)}
            emptyText='Không có lệnh'
          />
        </div>
      )}
      <div className='sendbox-inner'>
        {images.length > 0 && (
          <div className='thumbs'>
            {images.map((img, i) => (
              <FilePreview key={img.url} path={img.file.name || 'image.png'} size={img.file.size} imageSrc={img.url} onRemove={() => removeImage(i)} />
            ))}
          </div>
        )}
        <Input.TextArea
          value={text}
          onChange={(v) => {
            setText(v);
            setDismissed(null);
          }}
          aria-label='Tin nhắn cho trợ lý'
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length && !e.clipboardData.getData('text/plain')) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          autoSize={{ minRows: 2, maxRows: 8 }}
          placeholder='Nhắn cho trợ lý… (Enter gửi, Shift+Enter xuống dòng, / xem lệnh nhanh, dán hoặc kéo ảnh vào đây)'
        />
        <div className='sendbox-actions'>
          <Button icon={<Pic />} onClick={() => fileInput.current?.click()}>
            Ảnh
          </Button>
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
            <Button status='warning' icon={<PauseOne />} onClick={onStop}>
              Dừng
            </Button>
          ) : (
            <Button type='primary' icon={<Send />} loading={sending} onClick={() => void submit()}>
              Gửi
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
