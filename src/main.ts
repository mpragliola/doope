import './styles.css';
import { renderScanConfig } from './views/scan-config';
import { renderProgress, activateProgress } from './views/progress';
import { renderResults } from './views/results';

export type ViewName = 'scan-config' | 'progress' | 'results';

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, type: 'error' | 'success' = 'error') {
  const toast = document.getElementById('toast')!;
  toast.textContent = message;
  toast.className = `${type} visible`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

export function navigate(to: ViewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${to}`)?.classList.add('active');
  if (to === 'progress') activateProgress();
}

function bootstrap() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div id="view-scan-config" class="view active"></div>
    <div id="view-progress" class="view"></div>
    <div id="view-results" class="view"></div>
    <div id="toast"></div>
  `;
  renderScanConfig(document.getElementById('view-scan-config')!);
  renderProgress(document.getElementById('view-progress')!);
  renderResults(document.getElementById('view-results')!);
}

bootstrap();
