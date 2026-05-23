import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function formatUptime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export default function ProcessPanel({ projectName, process, allocations }) {
  const [expanded, setExpanded] = useState(true);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: process.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const port = allocations?.ports?.[process.name];
  const dotColor = process.status === 'running' ? 'var(--green)'
                 : process.status === 'crashed' ? 'var(--red)'
                 :                                'var(--text-secondary)';

  const apiBase = `/api/projects/${encodeURIComponent(projectName)}/processes/${encodeURIComponent(process.name)}`;

  const handleRestart = (e) => {
    e.stopPropagation();
    fetch(`${apiBase}/restart`, { method: 'POST' });
  };
  const handleStop = (e) => {
    e.stopPropagation();
    fetch(`${apiBase}/down`, { method: 'POST' });
  };
  const handleStart = (e) => {
    e.stopPropagation();
    fetch(`${apiBase}/up`, { method: 'POST' });
  };

  return (
    <div ref={setNodeRef} style={style} className="process-panel">
      <div className="process-panel__header" onClick={() => setExpanded(v => !v)}>
        <span
          className="drag-handle"
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
        >⠿</span>
        <span className="status-dot" style={{ color: dotColor }}>●</span>
        <span className="process-panel__name">{process.name}</span>
        <span className="process-panel__meta">
          {port ? `:${port}` : ''}
          {process.status === 'running' && process.uptime > 0
            ? `${port ? ' · ' : ''}up ${formatUptime(process.uptime)}`
            : ''}
        </span>
        <div className="process-panel__controls">
          {process.status === 'running' ? (
            <>
              <button className="btn btn--sm" onClick={handleRestart}>restart</button>
              <button className="btn btn--sm btn--danger" onClick={handleStop}>stop</button>
            </>
          ) : (
            <button className="btn btn--sm btn--success" onClick={handleStart}>start</button>
          )}
        </div>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="process-panel__body">
          <div className="empty-state" style={{ fontSize: 10 }}>
            Terminal — Task 6
          </div>
        </div>
      )}
    </div>
  );
}
