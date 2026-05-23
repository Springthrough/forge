import { useState, useEffect } from 'react';
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
  verticalListSortingStrategy,
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

export default function ProjectTab({ project }) {
  const processes    = useProjectProcesses(project?.name);
  const [order, setOrder] = useState([]);

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
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="process-list">
            {orderedProcesses.map(proc => (
              <ProcessPanel
                key={proc.name}
                projectName={project.name}
                process={proc}
                allocations={project.allocations}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
