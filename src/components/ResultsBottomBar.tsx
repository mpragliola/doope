import { useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useResultsStore } from '../stores/useResultsStore';
import { useToastStore } from '../stores/useToastStore';
import { api } from '../api';

export function ResultsBottomBar() {
  const store = useResultsStore();
  const { showToast } = useToastStore();
  const [open, setOpen] = useState(false);

  const markedCount = store.marks.size;
  const anyUnsafe = store.groups.some((g) => g.files.every((f) => store.marks.has(f.path)));
  const totalBytes = [...store.marks].reduce((sum, p) => sum + (store.fileIndex.get(p)?.size ?? 0), 0);

  let spaceLabel = 'No files marked for deletion';
  if (markedCount > 0) {
    const mb = (totalBytes / 1_048_576).toFixed(1);
    spaceLabel = anyUnsafe
      ? `⚠ ${markedCount} file${markedCount !== 1 ? 's' : ''} marked — some groups fully deleted (${mb} MB)`
      : `${markedCount} file${markedCount !== 1 ? 's' : ''} marked — ${mb} MB to free`;
  }

  async function confirmDelete() {
    const paths = [...store.marks];
    try {
      await api.deleteMarked(paths, anyUnsafe);
      showToast(`Deleted ${paths.length} file${paths.length !== 1 ? 's' : ''}`, 'success');
      const groups = await api.getDuplicateGroups();
      store.reset();
      store.setGroups(groups);
    } catch (e) {
      showToast(String(e));
    }
    setOpen(false);
  }

  return (
    <div className="px-4 py-3 bg-[#1a1a1a] border-t border-[#2a2a2a] flex items-center gap-3 flex-shrink-0">
      <span className="flex-1 text-[13px] text-[#aaa]">{spaceLabel}</span>
      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Trigger asChild>
          <button
            id="btn-delete"
            className="bg-[#ef4444] text-white rounded px-4 py-2 text-sm hover:bg-[#dc2626] disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={markedCount === 0}
          >
            Delete Marked <kbd className="text-[10px] opacity-70">Del</kbd>
          </button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/60 z-[900]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#1e1e1e] border border-[#333] rounded-lg p-6 max-w-[440px] w-full z-[901]">
            <AlertDialog.Title className="text-[15px] font-semibold mb-3">
              Confirm deletion
            </AlertDialog.Title>
            <AlertDialog.Description className="text-[13px] text-[#aaa] mb-6">
              {anyUnsafe
                ? `Delete ${markedCount} file${markedCount !== 1 ? 's' : ''}? Some groups will have NO survivors — all copies will be lost. This cannot be undone.`
                : `Delete ${markedCount} file${markedCount !== 1 ? 's' : ''}? This cannot be undone.`}
            </AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <button className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-4 py-2 text-sm hover:bg-[#333]">
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className="bg-[#ef4444] text-white rounded px-4 py-2 text-sm hover:bg-[#dc2626]"
                  onClick={confirmDelete}
                >
                  Delete
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
