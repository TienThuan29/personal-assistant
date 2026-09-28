import { AionSelect, PreferenceRow, SectionCard, SettingsPageHeader } from '@aionui/ui';
import { Alert, Button, Input, Space, Switch } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { DEFAULT_LLM, type LlmConfig, type SettingsView } from '../../shared/types';
import { api, errorText } from '../api';

export function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [llm, setLlm] = useState<LlmConfig>(DEFAULT_LLM);
  const [apiKey, setApiKey] = useState('');
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  useEffect(() => {
    api.settings
      .get()
      .then((v) => {
        setView(v);
        setLlm(v.llm);
        setOpenAtLogin(v.openAtLogin);
      })
      .catch((e) => setStatus({ type: 'error', text: errorText(e) }));
  }, []);

  const set = (patch: Partial<LlmConfig>) => setLlm((l) => ({ ...l, ...patch }));
  const save = async () => {
    await api.settings.save({ llm, apiKey: apiKey || undefined, openAtLogin });
    setApiKey('');
    setView(await api.settings.get());
  };
  const run = (kind: 'save' | 'test', fn: () => Promise<string>) => async () => {
    setBusy(kind);
    setStatus(null);
    try {
      setStatus({ type: 'success', text: await fn() });
    } catch (e) {
      setStatus({ type: 'error', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!view)
    return status ? (
      <div className='page'>
        <Alert type='error' content={status.text} />
      </div>
    ) : null;
  const azure = llm.provider === 'azure';
  const keyLabel = azure ? 'API key' : 'Access token';
  return (
    <div className='page settings'>
      <SettingsPageHeader title='Cài đặt' sticky={false} />
      <SectionCard title='Mô hình AI'>
        <PreferenceRow label='Nhà cung cấp' description='Cả hai đều dùng API tương thích OpenAI (tool calling + ảnh)'>
          <AionSelect
            aria-label='Nhà cung cấp'
            value={llm.provider}
            onChange={(v: LlmConfig['provider']) => {
              set({ provider: v });
              setApiKey('');
            }}
            style={{ width: 380 }}
            options={[
              { label: 'Azure AI Foundry', value: 'azure' },
              { label: 'LLM gateway', value: 'gateway' },
            ]}
          />
        </PreferenceRow>
        <PreferenceRow label='Endpoint' description={azure ? 'vd https://<resource>.openai.azure.com/' : 'Base URL, vd https://gateway.example.com/v1'}>
          <Input aria-label='Endpoint' placeholder='https://…' value={llm.endpoint} onChange={(v) => set({ endpoint: v })} style={{ width: 380 }} />
        </PreferenceRow>
        <PreferenceRow label={azure ? 'Deployment' : 'Model'} description='Model phải hỗ trợ tool calling và đọc ảnh'>
          <Input
            aria-label={azure ? 'Deployment' : 'Model'}
            placeholder='vd gpt-4o'
            value={llm.model}
            onChange={(v) => set({ model: v })}
            style={{ width: 380 }}
          />
        </PreferenceRow>
        {azure && (
          <PreferenceRow label='API version'>
            <Input aria-label='API version' value={llm.apiVersion} onChange={(v) => set({ apiVersion: v })} style={{ width: 380 }} />
          </PreferenceRow>
        )}
        <PreferenceRow
          label={keyLabel}
          description={view.hasKey[llm.provider] ? 'Đã lưu (mã hóa bằng Windows). Để trống nếu không đổi.' : 'Chưa có'}
        >
          <Input.Password
            aria-label={keyLabel}
            placeholder={view.hasKey[llm.provider] ? '••• đã lưu' : undefined}
            value={apiKey}
            onChange={setApiKey}
            style={{ width: 380 }}
          />
        </PreferenceRow>
      </SectionCard>
      <SectionCard title='Hệ thống'>
        <PreferenceRow label='Khởi động cùng Windows' description='Chạy ẩn ở khay hệ thống để nhắc nhở đúng giờ (chỉ bản đã đóng gói)'>
          <Switch aria-label='Khởi động cùng Windows' checked={openAtLogin} onChange={setOpenAtLogin} />
        </PreferenceRow>
      </SectionCard>
      <Space>
        <Button
          type='primary'
          loading={busy === 'save'}
          disabled={busy === 'test'}
          onClick={run('save', async () => (await save(), 'Đã lưu'))}
        >
          Lưu
        </Button>
        <Button
          loading={busy === 'test'}
          disabled={busy === 'save'}
          onClick={run('test', async () => (await save(), `Kết nối được. Model trả lời: ${await api.settings.test()}`))}
        >
          Lưu và kiểm tra kết nối
        </Button>
      </Space>
      {status && <Alert type={status.type} content={status.text} />}
    </div>
  );
}
