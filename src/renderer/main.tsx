import '@arco-design/web-react/dist/css/arco.css';
import '@aionui/ui/styles.css';
import '@aionui/ui/arco-theme.css';
import './styles.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../shared/i18n';
import { DEFAULT_UI, type UiSettings } from '../shared/types';
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
const i18n = createI18n(initial.language);

function Root() {
  const [ui, setUi] = useState(initial);
  // The single place renderer UI state changes: Settings calls setUi, main broadcasts ui:changed to every window.
  useEffect(
    () =>
      api.onUiChanged((next: UiSettings) => {
        void i18n.changeLanguage(next.language);
        setUi(next);
      }),
    []
  );
  return (
    <I18nextProvider i18n={i18n}>
      <UiContext.Provider value={ui}>
        <App />
      </UiContext.Provider>
    </I18nextProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
