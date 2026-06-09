import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Terminal from './Terminal.jsx';

function formatUptime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export default function ProcessPanel({
  projectName,
  process,
  allocations,
  isFullscreen = false,
  isHidden = false,
  isCarousel = false,
  isCentered = false,
  onToggleFullscreen,
  onCardClick,
  onHeaderDoubleClick,
}) {
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

  const handleToggleFullscreen = (e) => {
    e.stopPropagation();
    onToggleFullscreen?.();
  };

  const handleHeaderDoubleClick = (e) => {
    e.stopPropagation();
    onHeaderDoubleClick?.();
  };

  return (
    <div
      ref={setNodeRef}
      data-process-name={process.name}
      style={style}
      onClick={onCardClick}
      className={
        `process-panel${isFullscreen ? ' process-panel--fullscreen' : ''}` +
        `${isHidden ? ' process-panel--hidden' : ''}` +
        `${isCarousel && !isCentered ? ' process-panel--peek' : ''}`
      }
    >
      <div className="process-panel__header" onDoubleClick={handleHeaderDoubleClick}>
        <span
          className="drag-handle"
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        >⠿</span>
        <span className="status-dot" style={{ color: dotColor }}>●</span>
        <span className="process-panel__name">{process.name}</span>
        <span className="process-panel__meta">
          {port ? `:${port}` : ''}
          {process.status === 'running' && process.uptime > 0
            ? `${port ? ' · ' : ''}up ${formatUptime(process.uptime)}`
            : ''}
        </span>
        <div className="process-panel__controls" onDoubleClick={e => e.stopPropagation()}>
          {process.status === 'running' ? (
            <>
              <button className="btn btn--sm" onClick={handleRestart}>restart</button>
              <button className="btn btn--sm btn--danger" onClick={handleStop}>stop</button>
            </>
          ) : (
            <button className="btn btn--sm btn--success" onClick={handleStart}>start</button>
          )}
          <button
            className="btn btn--sm"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'exit fullscreen (Esc)' : 'fullscreen'}
          >
            {isFullscreen ? '⤡' : '⤢'}
          </button>
        </div>
      </div>
      <div className="process-panel__body">
        <Terminal projectName={projectName} processName={process.name} />
      </div>
    </div>
  );
}
