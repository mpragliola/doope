import { useScanConfigStore } from '../stores/useScanConfigStore';

export function ContentOptions() {
  const { videoStrategy, threshold, ffmpegAvailable, setVideoStrategy, setThreshold } =
    useScanConfigStore();

  return (
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
          type="range"
          min={0}
          max={20}
          value={threshold}
          className="w-full bg-[#1e1e1e] border border-[#333] rounded"
          onChange={(e) => setThreshold(parseInt(e.target.value))}
        />
        <div className="flex justify-between text-[11px] text-[#666] mt-0.5">
          <span>Exact only (0)</span><span>Very similar (20)</span>
        </div>
      </div>
    </div>
  );
}
