import '@arco-design/web-react/dist/css/arco.css';
import '@aionui/ui/styles.css';
import '@aionui/ui/arco-theme.css';
import 'virtual:uno.css';
import './assets/fonts/fonts.css';
import './styles.css';
import { Component, type ReactNode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../shared/i18n';
import { DEFAULT_UI, type UiSettings } from '../shared/types';
import { applyAccent } from './accent';
import { api, UiContext } from './api';
import { App } from './App';

// The language is read before the first render, so the UI never flashes in the other language.
// A missing preload or a failed call still renders, with the defaults, instead of a blank window.
let initial = DEFAULT_UI;
try {
  initial = (await api.settings.get()).ui;
} catch (e) {
  console.error('Reading UI settings failed', e);
}
let i18n: ReturnType<typeof createI18n> | undefined;
try {
  i18n = createI18n(initial.language);
} catch (e) {
  console.error('i18n init failed', e);
}
/** A colour that fails to compute keeps the current one instead of breaking the window. */
const setAccent = (hex: string) => {
  try {
    applyAccent(hex);
  } catch (e) {
    console.error('Applying the app colour failed', e);
  }
};
setAccent(initial.accent); // before the first render, so the default colour never flashes

/** Instead of a white window: a render error, a missing preload, or a preload older than this renderer. */
function Crash({ error }: { error: unknown }) {
  // i18n may be what failed, so fall back to static bilingual text.
  const t = (key: 'title' | 'reload', text: string): string => (i18n ? i18n.t(`crash.${key}`) : text);
  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h2>{t('title', 'Đã xảy ra lỗi / Something went wrong')}</h2>
      <button type='button' onClick={() => location.reload()}>
        {t('reload', 'Tải lại / Reload')}
      </button>
      <pre style={{ fontSize: 12, opacity: 0.6, whiteSpace: 'pre-wrap' }}>{error instanceof Error ? (error.stack ?? error.message) : String(error)}</pre>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return 'error' in this.state ? <Crash error={this.state.error} /> : this.props.children;
  }
}

function Root() {
  const [ui, setUi] = useState(initial);
  // The single place renderer UI state changes: Settings calls setUi, main broadcasts ui:changed to every window.
  useEffect(
    () =>
      api.onUiChanged((next: UiSettings) => {
        void i18n?.changeLanguage(next.language);
        setAccent(next.accent);
        setUi(next);
      }),
    []
  );
  return (
    <I18nextProvider i18n={i18n!}>
      <UiContext.Provider value={ui}>
        <App />
      </UiContext.Provider>
    </I18nextProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  api && i18n ? (
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  ) : (
    <Crash error={api ? 'i18n init failed' : 'window.api is missing (preload not loaded)'} />
  )
);
