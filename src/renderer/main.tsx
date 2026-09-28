import '@arco-design/web-react/dist/css/arco.css';
import '@aionui/ui/styles.css';
import '@aionui/ui/arco-theme.css';
import { UiProvider } from '@aionui/ui';
import { Markdown } from '@aionui/ui/markdown';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
  <UiProvider>
    <Markdown>{'**Xin chào** — `@aionui/ui` hoạt động.'}</Markdown>
  </UiProvider>
);
