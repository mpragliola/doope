const EXT_PALETTE = [
  '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa',
  '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#818cf8',
  '#2dd4bf', '#e879f9', '#facc15', '#4ade80', '#f43f5e',
  '#38bdf8',
];

const extColorCache = new Map<string, string>();
let extColorIdx = 0;

function extColor(e: string): string {
  if (!extColorCache.has(e)) {
    extColorCache.set(e, EXT_PALETTE[extColorIdx % EXT_PALETTE.length]);
    extColorIdx++;
  }
  return extColorCache.get(e)!;
}

interface ExtBadgesProps {
  extCounts: Map<string, number>;
}

export function ExtBadges({ extCounts }: ExtBadgesProps) {
  const sorted = [...extCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-wrap gap-1.5 max-w-[600px] w-full min-h-[22px]">
      {sorted.map(([ext, count]) => {
        const color = extColor(ext);
        return (
          <span
            key={ext}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-[10px] bg-[#1a1a1a]"
            style={{ border: `1px solid ${color}`, color }}
          >
            {ext} <span className="text-[#888]">{count}</span>
          </span>
        );
      })}
    </div>
  );
}
