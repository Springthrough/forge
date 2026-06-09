import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// Matches the grid column breakpoints in main.css.
const wideQuery = window.matchMedia('(min-width: 1400px)');
const medQuery  = window.matchMedia('(min-width: 900px)');
function viewportFontSize() {
  if (wideQuery.matches) return 10;  // 3-col
  if (medQuery.matches)  return 11;  // 2-col
  return 12;                          // 1-col
}

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
      fontSize: viewportFontSize(),
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

    const onBreakpointChange = () => {
      term.options.fontSize = viewportFontSize();
      try { fit.fit(); } catch {}
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    wideQuery.addEventListener('change', onBreakpointChange);
    medQuery.addEventListener('change',  onBreakpointChange);

    return () => {
      wideQuery.removeEventListener('change', onBreakpointChange);
      medQuery.removeEventListener('change',  onBreakpointChange);
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [projectName, processName]);

  return <div ref={containerRef} className="terminal-wrap" />;
}
