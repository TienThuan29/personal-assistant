import { Button, Checkbox, Input, Radio, Space, Tag } from '@arco-design/web-react';
import { Help } from '@icon-park/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AskAnswer, AskQuestion, AskReply, PendingAction } from '../../shared/types';

/** One question's draft: ticked options plus the Other row. A question with no options is just its text box. */
type Draft = { picked: string[]; otherOn: boolean; other: string };

const reply = (d: Draft): AskReply => ({ picked: d.picked, ...(d.otherOn && d.other.trim() ? { other: d.other.trim() } : {}) });
const answered = (d: Draft): boolean => d.picked.length > 0 || (d.otherOn && d.other.trim() !== '');

/** The card for an ask_user call (docs/ask-user-design.md): one question per step, Prev/Next, Submit on the last. */
export function AskCard({ action, onAnswer }: { action: PendingAction; onAnswer: (replies: AskReply[]) => Promise<boolean> }) {
  const { t } = useTranslation('chat');
  const questions = (action.args as { questions: AskQuestion[] }).questions;
  const pending = action.status === 'pending';
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map((q) => ({ picked: [], otherOn: q.options.length === 0, other: '' })));
  const [busy, setBusy] = useState(false);

  const q = questions[step];
  const d = drafts[step];
  const last = step === questions.length - 1;
  const patch = (p: Partial<Draft>) => setDrafts((all) => all.map((x, i) => (i === step ? { ...x, ...p } : x)));
  const toggle = (opt: string) => {
    if (!q.multiple) return patch({ picked: [opt], otherOn: false });
    patch({ picked: d.picked.includes(opt) ? d.picked.filter((p) => p !== opt) : [...d.picked, opt] });
  };
  const toggleOther = () => (q.multiple ? patch({ otherOn: !d.otherOn }) : patch({ picked: [], otherOn: true }));
  const submit = async () => {
    setBusy(true);
    try {
      await onAnswer(drafts.map(reply));
    } finally {
      setBusy(false);
    }
  };

  const result = action.result as { answers?: AskAnswer[] } | null;
  const tag =
    action.status === 'confirmed'
      ? { color: 'green', text: t('ask.answered') }
      : action.status === 'cancelled'
        ? { color: 'gray', text: t('ask.inChat') }
        : { color: undefined, text: t('ask.pending') };

  return (
    <div className='confirm-card' data-status={action.status}>
      <div className='confirm-title'>
        <span aria-hidden className='flex text-accent'>
          <Help />
        </span>
        {t('ask.title')}
        <Tag color={tag.color}>{tag.text}</Tag>
      </div>

      {!pending &&
        questions.map((x, i) => {
          const a = result?.answers?.[i];
          return (
            <div key={i}>
              <div className='muted'>{x.question}</div>
              {a && <div className='confirm-value'>{[...a.picked, ...(a.other ? [a.other] : [])].join(', ')}</div>}
            </div>
          );
        })}

      {pending && (
        <>
          <div role='group' aria-label={q.question}>
            {questions.length > 1 && <div className='muted'>{t('ask.step', { current: step + 1, total: questions.length })}</div>}
            <div className='ask-question'>{q.question}</div>
            <Space direction='vertical' size={4} style={{ width: '100%' }}>
              {q.options.map((opt) =>
                q.multiple ? (
                  <Checkbox key={opt} checked={d.picked.includes(opt)} onChange={() => toggle(opt)}>
                    {opt}
                  </Checkbox>
                ) : (
                  <Radio key={opt} checked={d.picked.includes(opt)} onChange={() => toggle(opt)}>
                    {opt}
                  </Radio>
                )
              )}
              {q.options.length > 0 &&
                (q.multiple ? (
                  <Checkbox checked={d.otherOn} onChange={toggleOther}>
                    {t('ask.other')}
                  </Checkbox>
                ) : (
                  <Radio checked={d.otherOn} onChange={toggleOther}>
                    {t('ask.other')}
                  </Radio>
                ))}
              {d.otherOn && (
                <Input.TextArea
                  aria-label={t('ask.other')}
                  autoFocus={q.options.length > 0}
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  placeholder={t('ask.otherPlaceholder')}
                  value={d.other}
                  onChange={(other) => patch({ other })}
                />
              )}
            </Space>
          </div>
          <Space>
            {questions.length > 1 && (
              <Button disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
                {t('ask.prev')}
              </Button>
            )}
            {last ? (
              <Button type='primary' loading={busy} disabled={!drafts.every(answered)} onClick={() => void submit()}>
                {t('ask.submit')}
              </Button>
            ) : (
              <Button type='primary' disabled={!answered(d)} onClick={() => setStep(step + 1)}>
                {t('ask.next')}
              </Button>
            )}
          </Space>
          <div className='muted'>{t('ask.hint')}</div>
        </>
      )}
    </div>
  );
}
