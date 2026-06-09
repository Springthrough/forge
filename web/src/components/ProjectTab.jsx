import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useProjectProcesses } from '../hooks/useProjectProcesses.js';
import ProcessPanel from './ProcessPanel.jsx';

function storageKey(name) { return `forge:panel-order:${name}`; }

function mergeOrder(stored, processes) {
  const names = processes.map(p => p.name);
  const valid = stored.filter(n => names.includes(n));
  names.forEach(n => { if (!valid.includes(n)) valid.push(n); });
  return valid;
}

function useServicesSection(project) {
  const [catalog, setCatalog] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    fetch('/api/services/catalog').then(r => r.json()).then(setCatalog).catch(() => {});
  }, []);

  const enabled = project?.config?.services ?? {};

  const toggle = useCallback(async (service) => {
    if (busy) return;
    setBusy(service);
    try {
      if (enabled[service]) {
        await fetch(`/api/projects/${encodeURIComponent(project.name)}/services/${service}`, { method: 'DELETE' });
      } else {
        await fetch(`/api/projects/${encodeURIComponent(project.name)}/services`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service }),
        });
      }
    } finally {
      setBusy(null);
    }
  }, [project?.name, enabled, busy]);

  return { catalog, enabled, busy, toggle };
}

export default function ProjectTab({ project, onProjectUpdate }) {
  const processes    = useProjectProcesses(project?.name);
  const [order, setOrder] = useState([]);
  const [fullscreenName, setFullscreenName] = useState(null);
  const { catalog, enabled, busy, toggle } = useServicesSection(project);

  // Reset fullscreen when the user switches to a different project tab.
  // App.jsx reuses the same ProjectTab instance across project changes, so
  // state would otherwise leak across projects.
  useEffect(() => {
    setFullscreenName(null);
  }, [project?.name]);

  // Auto-exit fullscreen if the fullscreened process disappears from the list
  // (e.g. removed from config, never came back after a restart).
  useEffect(() => {
    if (fullscreenName && !processes.some(p => p.name === fullscreenName)) {
      setFullscreenName(null);
    }
  }, [fullscreenName, processes]);

  useEffect(() => {
    if (!fullscreenName) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') setFullscreenName(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fullscreenName]);

  useEffect(() => {
    if (!project || processes.length === 0) return;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey(project.name)) ?? '[]');
      setOrder(mergeOrder(stored, processes));
    } catch {
      setOrder(processes.map(p => p.name));
    }
  }, [project?.name, processes.length]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id));
      localStorage.setItem(storageKey(project.name), JSON.stringify(next));
      return next;
    });
  }

  const handleUpAll = () =>
    fetch(`/api/projects/${encodeURIComponent(project.name)}/processes/up`, { method: 'POST' });
  const handleDownAll = () =>
    fetch(`/api/projects/${encodeURIComponent(project.name)}/processes/down`, { method: 'POST' });

  if (!project) return <div className="empty-state">Project not found.</div>;

  const orderedProcesses = order.length > 0
    ? order.map(name => processes.find(p => p.name === name)).filter(Boolean)
    : processes;

  return (
    <div className="project-tab">
      <div className="project-tab__header">
        <div className="project-tab__title">
          <span className="project-tab__name">{project.name}</span>
          <span className="project-tab__path">{project.path}</span>
        </div>
        <div className="project-tab__actions">
          <button className="btn btn--success btn--sm" onClick={handleUpAll}>▶ up all</button>
          <button className="btn btn--danger btn--sm" onClick={handleDownAll}>■ down all</button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={order}
          strategy={rectSortingStrategy}
          disabled={!!fullscreenName}
        >
          <div className={`process-list${fullscreenName ? ' process-list--fullscreen' : ''}`}>
            {orderedProcesses.map(proc => {
              const isFs = proc.name === fullscreenName;
              return (
                <ProcessPanel
                  key={proc.name}
                  projectName={project.name}
                  process={proc}
                  allocations={project.allocations}
                  isFullscreen={isFs}
                  isHidden={!!fullscreenName && !isFs}
                  onToggleFullscreen={() =>
                    setFullscreenName(prev => prev === proc.name ? null : proc.name)
                  }
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {!fullscreenName && catalog.length > 0 && (
        <div className="services-section">
          <div className="section-label">Shared Services</div>
          <div className="services-toggle-list">
            {catalog.map(svc => {
              const isEnabled = !!enabled[svc];
              const isBusy = busy === svc;
              const envVar = enabled[svc]?.env;
              return (
                <div key={svc} className="services-toggle-row">
                  <span className="services-toggle-name">{svc}</span>
                  {isEnabled && envVar && (
                    <span className="services-toggle-env">{envVar}</span>
                  )}
                  <button
                    className={`btn btn--sm ${isEnabled ? 'btn--danger' : 'btn--outline'}`}
                    onClick={() => toggle(svc)}
                    disabled={isBusy}
                  >
                    {isBusy ? '…' : isEnabled ? 'disable' : 'enable'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
