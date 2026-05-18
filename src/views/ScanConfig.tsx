import type { ViewName } from '../App';
export function ScanConfig({ active, onNavigate }: { active: boolean; onNavigate: (v: ViewName) => void }) {
  return <div className={active ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>ScanConfig</div>;
}
