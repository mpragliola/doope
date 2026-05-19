import { useEffect, useRef } from 'react';
import type { ViewName } from '../App';
import { useProgressStore } from '../stores/useProgressStore';
import { api } from '../api';
import type { ProgressEvent } from '../types';

export function useProgressListener(
  active: boolean,
  onNavigate: (v: ViewName) => void
) {
  const store = useProgressStore();
  const pendingRef = useRef<ProgressEvent | null>(null);
  const rafRef = useRef<number>(0);
  const unlistenRef = useRef<(() => void) | null>(null);
  const unlistenPromiseRef = useRef<Promise<() => void> | null>(null);
  const onNavigateRef = useRef(onNavigate);

  useEffect(() => { onNavigateRef.current = onNavigate; });

  useEffect(() => {
    if (!active) return;

    store.reset();
    pendingRef.current = null;

    function flush() {
      rafRef.current = 0;
      const evt = pendingRef.current;
      if (!evt) return;
      pendingRef.current = null;
      store.applyEvent(evt);
    }

    const p = api.onProgress((evt) => {
      if (evt.phase === 'done') {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
        p.then((fn) => { fn(); unlistenRef.current = null; });
        onNavigateRef.current('results');
        window.dispatchEvent(new CustomEvent('scan-complete'));
        return;
      }
      if (evt.phase === 'walking') {
        store.applyEvent(evt);
        return;
      }
      pendingRef.current = evt;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    });
    unlistenPromiseRef.current = p;
    p.then((fn) => { unlistenRef.current = fn; });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      } else {
        unlistenPromiseRef.current?.then((fn) => fn());
      }
    };
  }, [active]);

  async function cancel() {
    await api.cancelScan();
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    } else {
      unlistenPromiseRef.current?.then((fn) => fn());
    }
    onNavigateRef.current('results');
    window.dispatchEvent(new CustomEvent('scan-complete'));
  }

  return { cancel };
}
