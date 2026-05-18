import { useEffect } from 'react';
import type { ViewName } from '../App';
import { Toolbar } from '../components/Toolbar';
import { FolderList } from '../components/FolderList';
import { useScanConfigStore } from '../stores/useScanConfigStore';
import { useScanStateStore } from '../stores/useScanStateStore';
import { useToastStore } from '../stores/useToastStore';
import { api } from '../api';

const DoopeLogo = () => (
  <svg width="22" height="26" viewBox="0 0 22 26" fill="none" aria-hidden="true">
    <rect x="6" y="0" width="15" height="19" rx="2.5" fill="#0f1e2e" stroke="#3b82f6" strokeWidth="1.5" strokeOpacity="0.45"/>
    <rect x="1" y="5" width="15" height="19" rx="2.5" fill="#3b82f6"/>
    <rect x="4.5" y="10.5" width="7.5" height="1.8" rx="0.9" fill="rgba(255,255,255,0.82)"/>
    <rect x="4.5" y="14" width="5.5" height="1.8" rx="0.9" fill="rgba(255,255,255,0.52)"/>
    <rect x="4.5" y="17.5" width="6.5" height="1.8" rx="0.9" fill="rgba(255,255,255,0.3)"/>
  </svg>
);

interface ScanConfigProps {
  active: boolean;
  onNavigate: (v: ViewName) => void;
}

export function ScanConfig({ active, onNavigate }: ScanConfigProps) {
  const {
    folders, mode, videoStrategy, threshold, ffmpegAvailable,
    setMode, setVideoStrategy, setThreshold, setFfmpegAvailable,
  } = useScanConfigStore();
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

  const showContentOptions = mode !== 'filename';

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

          {showContentOptions && (
            <div>
              <label className="block text-[13px] text-[#aaa] mb-1">Video Strategy</label>
              {ffmpegAvailable === false && (
                <div className="text-[12px] text-[#fbbf24] bg-[#1c1407] border border-[#78350f] rounded px-2.5 py-1.5 mb-1.5">
                  ⚠ ffmpeg not found — perceptual video strategies unavailable
                </div>
              )}
              <select
                className="w-full bg-[#1e1e1e] border border-[#333] rounded text-[#e2e2e2] px-2.5 py-1.5 text-[13px]"
                value={videoStrategy}
                onChange={(e) => setVideoStrategy(e.target.value as any)}
              >
                <option value="first_frame">First frame perceptual hash</option>
                <option value="exact_only">Exact hash only (fastest)</option>
                <option value="multi_frame" disabled={ffmpegAvailable === false}>
                  Multi-frame (8 frames, slowest)
                </option>
              </select>

              <div className="mt-4">
                <label className="block text-[13px] text-[#aaa] mb-1">
                  Perceptual Similarity Threshold: <span className="text-[#e2e2e2]">{threshold}</span>
                </label>
                <input
                  type="range" min={0} max={20} value={threshold}
                  className="w-full bg-[#1e1e1e] border border-[#333] rounded"
                  onChange={(e) => setThreshold(parseInt(e.target.value))}
                />
                <div className="flex justify-between text-[11px] text-[#666] mt-0.5">
                  <span>Exact only (0)</span><span>Very similar (20)</span>
                </div>
              </div>
            </div>
          )}

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
