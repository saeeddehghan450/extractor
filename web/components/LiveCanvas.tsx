'use client';

// React wrapper around the WebSocket live view (lib/liveView.ts): the canvas, overlays and input
// handling stay imperative; the parent gets the LiveView instance through `onReady`.

import { useEffect, useRef, type CSSProperties } from 'react';
import { LiveView, type LiveViewOptions } from '@/lib/liveView';

export function LiveCanvas({ id, options, onReady, style }: {
  id?: string;
  /** read through a ref, so changing callbacks never reconnects the socket */
  options: LiveViewOptions;
  onReady?: (view: LiveView | null) => void;
  style?: CSSProperties;
}) {
  const box = useRef<HTMLDivElement>(null);
  const opts = useRef(options);
  opts.current = options;
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    // callbacks are forwarded to the latest props
    const proxy: LiveViewOptions = {
      onStatus: s => opts.current.onStatus?.(s),
      onNavigated: u => opts.current.onNavigated?.(u),
      onError: m => opts.current.onError?.(m),
      onConnection: c => opts.current.onConnection?.(c),
      onPick: i => opts.current.onPick?.(i),
      itemSelector: () => opts.current.itemSelector?.(),
      onFrame: () => opts.current.onFrame?.()
    };
    const view = new LiveView(box.current!, proxy);
    ready.current?.(view);
    return () => {
      ready.current?.(null);
      view.destroy();
    };
  }, []);

  return <div id={id} ref={box} style={style} />;
}
