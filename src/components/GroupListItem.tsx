import type { DuplicateGroup } from '../types';

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
}

interface GroupListItemProps {
  group: DuplicateGroup;
  marks: Set<string>;
  isSelected: boolean;
  isMultiSelected: boolean;
  style: React.CSSProperties;
  onClick: (e: React.MouseEvent) => void;
}

export function GroupListItem({ group: g, marks, isSelected, isMultiSelected, style, onClick }: GroupListItemProps) {
  const survivors = g.files.filter((f) => !marks.has(f.path)).length;
  const markedCount = g.files.length - survivors;
  const noSurvivors = survivors === 0 && markedCount > 0;
  const borderColor = noSurvivors ? '#ef4444' : markedCount > 0 ? '#f59e0b' : 'transparent';
  const bg = isSelected ? '#1e2a3a' : isMultiSelected ? '#131a25' : undefined;
  const wastedMb = (g.wasted_bytes / 1_048_576).toFixed(1);

  let badge = '=';
  let badgeColor = '#3b82f6';
  if (g.duplicate_type === 'perceptual') {
    badge = g.max_distance === 0 ? '≈' : '~';
    badgeColor = g.max_distance === 0 ? '#22c55e' : '#a855f7';
  } else if (g.duplicate_type === 'filename') {
    badge = 'F';
    badgeColor = '#f59e0b';
  }

  const distLabel =
    g.duplicate_type === 'perceptual' && g.max_distance !== undefined
      ? (() => {
          const sim = Math.round(((64 - g.max_distance) / 64) * 100);
          const c = sim === 100 ? '#22c55e' : sim >= 90 ? '#a855f7' : '#f59e0b';
          return <span style={{ fontSize: 10, color: c, fontWeight: 600, marginLeft: 4 }}>{sim}% similar</span>;
        })()
      : null;

  return (
    <div
      style={{
        ...style,
        background: bg,
        borderLeft: `3px solid ${borderColor}`,
        borderBottom: '1px solid #1e1e1e',
        padding: '10px 12px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        boxSizing: 'border-box',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ background: badgeColor, color: '#fff', fontSize: 10, borderRadius: 3, padding: '1px 5px' }}>
          {badge}
        </span>
        {distLabel}
        <span style={{ fontSize: 13, fontWeight: 500 }}>{g.files.length} files</span>
        <span style={{ fontSize: 11, color: '#666', marginLeft: 'auto' }}>{wastedMb} MB</span>
      </div>
      <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2 }}>
        {g.files.map((f) => {
          const pathColor = markedCount > 0 ? (marks.has(f.path) ? '#f87171' : '#4ade80') : '#555';
          return (
            <span
              key={f.path}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: pathColor }}
              title={f.path}
            >
              {shortPath(f.path)}
            </span>
          );
        })}
      </div>
      {markedCount > 0 && (
        <div style={{ fontSize: 10, color: noSurvivors ? '#ef4444' : '#888', marginTop: 2 }}>
          {markedCount} marked → {survivors} survive{noSurvivors ? ' ⚠' : ''}
        </div>
      )}
    </div>
  );
}
