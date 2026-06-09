import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
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
  const [viewMode, setViewMode] = useState('grid');
  const carouselRef = useRef(null);
  const prevViewModeRef = useRef('grid');
  const [centeredName, setCenteredName] = useState(null);
  const { catalog, enabled, busy, toggle } = useServicesSection(project);

  // Reset fullscreen when the user switches to a different project tab.
  // App.jsx reuses the same ProjectTab instance across project changes, so
  // state would otherwise leak across projects.
  useEffect(() => {
    setFullscreenName(null);
    setViewMode('grid');
  }, [project?.name]);

  // Spec: entering carousel from a non-carousel state resets to the first card
  // (`scrollLeft = 0`). Fullscreen ↔ carousel transitions preserve scrollLeft —
  // we guard with `prevViewModeRef.current !== 'carousel'` so this only fires
  // on grid → carousel, not on fullscreen → carousel (where viewMode never
  // changed and the previous value is already 'carousel').
  useEffect(() => {
    if (viewMode === 'carousel' && prevViewModeRef.current !== 'carousel' && !fullscreenName) {
      const el = carouselRef.current;
      if (el) el.scrollLeft = 0;
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode, fullscreenName]);

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

  // Track which card is closest to the carousel center. useLayoutEffect (not
  // useEffect) so the very first paint after entering carousel already has
  // `centeredName` set — avoids a one-frame flash where every card looks
  // centered (no peek class applied yet).
  useLayoutEffect(() => {
    if (viewMode !== 'carousel' || fullscreenName) {
      setCenteredName(null);
      return;
    }
    const el = carouselRef.current;
    if (!el) return;
    function update() {
      const containerCenter = el.scrollLeft + el.clientWidth / 2;
      let best = null, bestDist = Infinity;
      for (const child of el.children) {
        const c = child.offsetLeft + child.offsetWidth / 2;
        const d = Math.abs(c - containerCenter);
        if (d < bestDist) { bestDist = d; best = child; }
      }
      if (best) setCenteredName(best.dataset.processName ?? null);
    }
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [viewMode, fullscreenName, processes.length]);

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

  const centerCard = useCallback((name) => {
    const el = carouselRef.current;
    if (!el) return;
    const target = el.querySelector(`[data-process-name="${CSS.escape(name)}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, []);

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
          <button
            className="btn btn--sm"
            onClick={() => setViewMode(m => m === 'carousel' ? 'grid' : 'carousel')}
            title={viewMode === 'carousel' ? 'switch to grid view' : 'switch to carousel view'}
          >
            {viewMode === 'carousel' ? '⊞ grid' : '⏵⏴ carousel'}
          </button>
          <button className="btn btn--success btn--sm" onClick={handleUpAll}>▶ up all</button>
          <button className="btn btn--danger btn--sm" onClick={handleDownAll}>■ down all</button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={order}
          strategy={rectSortingStrategy}
          disabled={viewMode === 'carousel' || !!fullscreenName}
        >
          <div
            ref={carouselRef}
            className={
              fullscreenName        ? 'process-list process-list--fullscreen'
              : viewMode === 'carousel' ? 'process-list process-list--carousel'
              : 'process-list'
            }
          >
            {orderedProcesses.map(proc => {
              const isFs = proc.name === fullscreenName;
              const isCarousel = viewMode === 'carousel' && !fullscreenName;
              const isCentered = isCarousel && proc.name === centeredName;
              return (
                <ProcessPanel
                  key={proc.name}
                  projectName={project.name}
                  process={proc}
                  allocations={project.allocations}
                  isFullscreen={isFs}
                  isHidden={!!fullscreenName && !isFs}
                  isCarousel={isCarousel}
                  isCentered={isCentered}
                  onToggleFullscreen={() =>
                    setFullscreenName(prev => prev === proc.name ? null : proc.name)
                  }
                  onCardClick={isCarousel && !isCentered ? () => centerCard(proc.name) : undefined}
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
