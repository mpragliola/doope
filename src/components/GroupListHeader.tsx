import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useResultsStore, availableExts, type SortMode } from '../stores/useResultsStore';

const SORT_OPTIONS: { label: string; value: SortMode }[] = [
  { label: 'Default', value: 'default' },
  { label: 'Files ↓', value: 'files-desc' },
  { label: 'Files ↑', value: 'files-asc' },
  { label: 'Size ↓', value: 'size-desc' },
  { label: 'Size ↑', value: 'size-asc' },
];

export function GroupListHeader() {
  const { groups, filterExt, sortMode, setFilterExt, setSortMode } = useResultsStore();
  const exts = availableExts(groups);

  return (
    <div className="px-3 py-1.5 text-[11px] text-[#666] border-b border-[#1e1e1e] flex items-center gap-1 flex-shrink-0">
      <span className="flex-1">DUPLICATE GROUPS</span>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-2 py-0.5 text-[11px] hover:bg-[#333]">
            {filterExt ? `${filterExt} ▾` : 'Ext ▾'}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="bg-[#1e1e1e] border border-[#333] rounded py-1 min-w-[90px] max-h-[200px] overflow-y-auto z-50">
            {[null, ...exts].map((ext) => (
              <DropdownMenu.Item
                key={ext ?? '__all'}
                className="px-3 py-1.5 text-[11px] cursor-pointer outline-none hover:bg-[#2a2a2a]"
                style={{ color: filterExt === ext ? '#e2e2e2' : '#888' }}
                onSelect={() => setFilterExt(ext)}
              >
                {filterExt === ext ? '✓ ' : ''}{ext ?? 'All'}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-2 py-0.5 text-[11px] hover:bg-[#333]">
            {sortMode === 'default'
              ? 'Sort ▾'
              : `Sort: ${SORT_OPTIONS.find((o) => o.value === sortMode)!.label} ▾`}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="bg-[#1e1e1e] border border-[#333] rounded py-1 min-w-[110px] z-50">
            {SORT_OPTIONS.map((o) => (
              <DropdownMenu.Item
                key={o.value}
                className="px-3 py-1.5 text-[11px] cursor-pointer outline-none hover:bg-[#2a2a2a]"
                style={{
                  color: sortMode === o.value ? '#e2e2e2' : '#888',
                  background: sortMode === o.value ? '#2a2a2a' : undefined,
                }}
                onSelect={() => setSortMode(o.value)}
              >
                {sortMode === o.value ? '✓ ' : ''}{o.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
