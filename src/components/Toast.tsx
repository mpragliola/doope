import { useToastStore } from '../stores/useToastStore';

export function Toast() {
  const { message, type, visible } = useToastStore();

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 bg-[#1f2937] border rounded-lg px-5 py-3 text-[13px] z-[999] max-w-[500px] text-center ${
        type === 'error' ? 'border-[#ef4444] text-[#fca5a5]' : 'border-[#22c55e] text-[#86efac]'
      }`}
    >
      {message}
    </div>
  );
}
