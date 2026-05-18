import { useEffect } from 'react';
import { useResultsStore } from '../stores/useResultsStore';
import { useToastStore } from '../stores/useToastStore';
import { api } from '../api';

export function useResultsKeys(active: boolean) {
  const store = useResultsStore();
  const { showToast } = useToastStore();

  useEffect(() => {
    if (!active) return;

    async function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (document.getElementById('lightbox-overlay')) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        document.getElementById('btn-regroup')?.click();
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        const btn = document.getElementById('btn-delete') as HTMLButtonElement | null;
        if (btn && !btn.disabled) btn.click();
        return;
      }

      const { selectedGroupId, selectedGroupIds, groups, autoMarkMode } = store;
      if (!selectedGroupId) return;

      const group = groups.find((g) => g.id === selectedGroupId);
      if (!group) return;
      const isMulti = selectedGroupIds.size > 1;
      const targets = isMulti ? groups.filter((g) => selectedGroupIds.has(g.id)) : [group];

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        try {
          for (const g of targets) {
            const toMark = await api.autoMarkGroup(g.id, autoMarkMode);
            store.markAllPaths(toMark);
          }
        } catch (err) {
          showToast(String(err));
        }
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        targets.forEach((g) => store.unmarkAllPaths(g.files.map((f) => f.path)));
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        targets.forEach((g) => store.markAllPaths(g.files.map((f) => f.path)));
      } else if (!isMulti) {
        const n = parseInt(e.key);
        if (!isNaN(n) && n >= 1 && n <= group.files.length) {
          e.preventDefault();
          group.files.forEach((f, i) => {
            if (i === n - 1) store.unmarkAllPaths([f.path]);
            else store.markAllPaths([f.path]);
          });
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
