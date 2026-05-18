import { useEffect } from 'react';
import type { ViewName } from '../App';
import { Toolbar } from '../components/Toolbar';
import { FolderList } from '../components/FolderList';
import { DoopeLogo } from '../components/DoopeLogo';
import { ContentOptions } from '../components/ContentOptions';
import { useScanConfigStore } from '../stores/useScanConfigStore';
import { useScanStateStore } from '../stores/useScanStateStore';
import { useToastStore } from '../stores/useToastStore';
import { api } from '../api';

interface ScanConfigProps {
  active: boolean;
  onNavigate: (v: ViewName) => void;
}

export function ScanConfig({ active, onNavigate }: ScanConfigProps) {
  const { folders, mode, videoStrategy, threshold, setMode, setFfmpegAvailable } =
    useScanConfigStore();
  const { setScanState } = useScanStateStore();
  const { showToast } = useToastStore();

  useEffect(() => {
    api.checkFfmpeg()
      .then(setFfmpegAvailable)
      .catch((e) => showToast(`IPC broken: ${e}`));
  }, []);

  async function clearCache() {
    await api.clearCache();
    showToast('Cache cleared', 'success');
  }

  async function startScan() {
    setScanState(threshold, folders);
    await api.setFolderPriorities(folders);
    // Navigate first so the user sees the progress view immediately.
    // The retry loop below handles the case where a previous scan is still winding down.
    onNavigate('progress');

    const MAX_WAIT_MS = 30_000;
    const RETRY_MS = 500;
    const deadline = Date.now() + MAX_WAIT_MS;

    while (true) {
      try {
        await api.scan({
          folders,
          mode,
          video_strategy: videoStrategy,
          phash_threshold: threshold,
          folder_priorities: folders,
          multi_frame_count: 8,
        });
        return;
      } catch (e) {
        const msg = String(e);
        if (msg.includes('scan already in progress')) {
          if (Date.now() >= deadline) {
            showToast('Timed out waiting for previous scan to stop');
            onNavigate('scan-config');
            return;
          }
          await new Promise((r) => setTimeout(r, RETRY_MS));
        } else {
          showToast(msg);
          onNavigate('scan-config');
          return;
        }
      }
    }
  }

  return (
    <div className={active ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
      <Toolbar>
        <h1 className="flex-1 text-[17px] font-semibold tracking-tight flex items-center gap-2">
          <DoopeLogo /> Doope
        </h1>
        <button
          className="bg-[#2a2a2a] text-[#e2e2e2] border border-[#444] rounded px-4 py-2 text-sm hover:bg-[#333]"
          onClick={clearCache}
        >
          Clear Cache
        </button>
      </Toolbar>

      <div className="flex flex-1 overflow-hidden">
        <FolderList />

        <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto">
          <div>
            <label className="block text-[13px] text-[#aaa] mb-1">Scan Mode</label>
            <select
              className="w-full bg-[#1e1e1e] border border-[#333] rounded text-[#e2e2e2] px-2.5 py-1.5 text-[13px]"
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
            >
              <option value="both">Both (Filename + Content)</option>
              <option value="filename">Filename only (same name + size)</option>
              <option value="content">Content only (hash)</option>
            </select>
          </div>

          {mode !== 'filename' && <ContentOptions />}

          <div className="mt-auto">
            <button
              className="w-full py-3 text-[15px] font-medium rounded bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={folders.length === 0}
              onClick={startScan}
            >
              {folders.length === 0
                ? 'Select folders to scan'
                : `Start Scan (${folders.length} folder${folders.length > 1 ? 's' : ''})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
