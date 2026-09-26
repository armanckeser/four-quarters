import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PartHarness } from './PartHarness';
import { parts } from './parts';
import '../styles.css';

const params = new URLSearchParams(window.location.search);
const partName = params.get('part') ?? Object.keys(parts)[0] ?? '';
const entry = parts[partName];

function HarnessApp() {
  if (!entry) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }}>
        Unknown part: <strong>{partName || '(none)'}</strong>. Available:{' '}
        {Object.keys(parts).join(', ') || '(none registered)'}
      </div>
    );
  }
  return (
    <PartHarness cameraPosition={entry.cameraPosition} target={entry.target}>
      {entry.render()}
    </PartHarness>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HarnessApp />
  </StrictMode>,
);
