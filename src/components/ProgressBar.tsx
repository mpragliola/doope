interface ProgressBarProps {
  pct: number;
  indeterminate: boolean;
}

export function ProgressBar({ pct, indeterminate }: ProgressBarProps) {
  return (
    <div className="bg-[#1e1e1e] rounded-lg h-3 overflow-hidden">
      <div
        className={indeterminate ? 'progress-indeterminate h-full bg-[#3b82f6]' : 'h-full bg-[#3b82f6] transition-[width_0.1s]'}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
