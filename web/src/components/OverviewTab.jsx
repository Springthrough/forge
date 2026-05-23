import { useServices } from '../hooks/useServices.js';
import ProjectCard from './ProjectCard.jsx';
import ServicesPanel from './ServicesPanel.jsx';

export default function OverviewTab({ projects, onOpenProject }) {
  const services = useServices();

  return (
    <div className="overview">
      <div>
        <div className="section-label">Projects</div>
        {projects.length === 0 ? (
          <div className="empty-state" style={{ height: 'auto', padding: '20px 0' }}>
            No projects registered. Run: forge add
          </div>
        ) : (
          <div className="project-grid">
            {projects.map(p => (
              <ProjectCard key={p.name} project={p} onOpen={onOpenProject} />
            ))}
          </div>
        )}
      </div>
      <ServicesPanel services={services} />
    </div>
  );
}
