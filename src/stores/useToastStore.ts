import { create } from 'zustand';

interface ToastState {
  message: string;
  type: 'error' | 'success';
  visible: boolean;
  _timer: ReturnType<typeof setTimeout> | null;
  showToast: (message: string, type?: 'error' | 'success') => void;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  message: '',
  type: 'error',
  visible: false,
  _timer: null,
  showToast: (message, type = 'error') => {
    const prev = get()._timer;
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => set({ visible: false }), 4000);
    set({ message, type, visible: true, _timer: timer });
  },
}));
