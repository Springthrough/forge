import { useProjectProcesses } from '../hooks/useProjectProcesses.js';

export default function ProjectCard({ project, onOpen }) {
  const processes = useProjectProcesses(project.name);
  const configProcs = project.config?.processes ?? [];
  const total   = configProcs.length;
  const running = processes.filter(p => p.status === 'running').length;

  const badgeClass = total === 0        ? 'badge--grey'
                   : running === total  ? 'badge--green'
                   : running === 0      ? 'badge--red'
                   :                      'badge--yellow';

  return (
    <div className="project-card">
      <div className="project-card__header">
        <span className="project-card__name">{project.name}</span>
        {total > 0 && (
          <span className={`badge ${badgeClass}`}>{running}/{total} up</span>
        )}
      </div>
      <div className="project-card__path">{project.path}</div>
      <div className="project-card__procs">
        {configProcs.map(proc => {
          const ps   = processes.find(p => p.name === proc.name);
          const port = project.allocations?.ports?.[proc.name];
          const dotColor = ps?.status === 'running' ? 'var(--green)'
                         : ps?.status === 'crashed' ? 'var(--red)'
                         :                            'var(--text-secondary)';
          return (
            <span key={proc.name} className="process-dot">
              <span style={{ color: dotColor }}>●</span>
              {proc.name}{port ? ` :${port}` : ''}
            </span>
          );
        })}
      </div>
      <button className="btn btn--outline btn--sm" onClick={() => onOpen(project.name)}>
        Open ↗
      </button>
    </div>
  );
}
