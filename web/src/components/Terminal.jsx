import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// Scale xterm's font with the card's own width — naturally handles both
// the 3/2/1-col grid breakpoints and the fullscreen jump to viewport width.
function fontSizeForWidth(w) {
  if (w < 600)  return 10;
  if (w < 900)  return 11;
  if (w < 1300) return 12;
  if (w < 1700) return 13;
  return 14;
}

export default function Terminal({ projectName, processName, clearKey = 0 }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);

  useEffect(() => {
    const initialWidth = containerRef.current?.clientWidth ?? 0;
    const term = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#f0f6fc',
        cursor:     '#f0f6fc',
        selection:  'rgba(248,241,227,0.2)',
      },
      fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
      fontSize: fontSizeForWidth(initialWidth || 800),
      cursorBlink: true,
      scrollback: 1000,
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    const ws = new WebSocket(
      `ws://${window.location.host}/ws?project=${encodeURIComponent(projectName)}&process=${encodeURIComponent(processName)}`
    );

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') term.write(msg.data);
        if (msg.type === 'error')  term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
      } catch {}
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? containerRef.current?.clientWidth ?? 0;
      const desired = fontSizeForWidth(w);
      if (w > 0 && term.options.fontSize !== desired) {
        term.options.fontSize = desired;
      }
      try { fit.fit(); } catch {}
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      ws.close();
      termRef.current = null;
      term.dispose();
    };
  }, [projectName, processName]);

  // Bumping `clearKey` (parent does this on restart/start) clears the visible
  // viewport AND xterm's scrollback so the next logs are the fresh boot.
  // Skip the initial render (clearKey === 0) — only react to bumps.
  useEffect(() => {
    if (clearKey > 0) termRef.current?.clear();
  }, [clearKey]);

  return <div ref={containerRef} className="terminal-wrap" />;
}
