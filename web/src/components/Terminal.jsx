import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export default function Terminal({ projectName, processName }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#f0f6fc',
        cursor:     '#f0f6fc',
        selection:  'rgba(248,241,227,0.2)',
      },
      fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 1000,
    });

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

    const observer = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [projectName, processName]);

  return <div ref={containerRef} className="terminal-wrap" />;
}
