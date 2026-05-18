import { create } from 'zustand';

// Module-level — not part of store state
let toastTimer: ReturnType<typeof setTimeout> | null = null;

interface ToastState {
  message: string;
  type: 'error' | 'success';
  visible: boolean;
  showToast: (message: string, type?: 'error' | 'success') => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  message: '',
  type: 'error',
  visible: false,
  showToast: (message, type = 'error') => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ visible: false }), 4000);
    set({ message, type, visible: true });
  },
}));
