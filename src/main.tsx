import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DeckProvider } from './deck/DeckProvider';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeckProvider>
      <App />
    </DeckProvider>
  </StrictMode>,
);
