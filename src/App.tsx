import { useState } from 'react';
import { ScanConfig } from './views/ScanConfig';
import { Progress } from './views/Progress';
import { Results } from './views/Results';
import { Toast } from './components/Toast';

export type ViewName = 'scan-config' | 'progress' | 'results';

export function App() {
  const [view, setView] = useState<ViewName>('scan-config');

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <ScanConfig active={view === 'scan-config'} onNavigate={setView} />
      <Progress active={view === 'progress'} onNavigate={setView} />
      <Results active={view === 'results'} onNavigate={setView} />
      <Toast />
    </div>
  );
}
