import '@arco-design/web-react/dist/css/arco.css';
import '@aionui/ui/styles.css';
import '@aionui/ui/arco-theme.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
