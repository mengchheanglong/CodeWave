import { createRoot } from 'react-dom/client';
import '@codewave/ui-kit/tokens.css';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find #root mount point.');
}

createRoot(rootElement).render(<App />);
