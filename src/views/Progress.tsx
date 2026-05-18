import type { ViewName } from '../App';
export function Progress({ active, onNavigate }: { active: boolean; onNavigate: (v: ViewName) => void }) {
  return <div className={active ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>Progress</div>;
}
