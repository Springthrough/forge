import { useState } from 'react';
import { useProjects } from './hooks/useProjects.js';
import TabBar from './components/TabBar.jsx';
import OverviewTab from './components/OverviewTab.jsx';
import ProjectTab from './components/ProjectTab.jsx';

export default function App() {
  const projects = useProjects();
  const [activeTab, setActiveTab] = useState('overview');

  const activeProject = projects.find(p => p.name === activeTab);

  return (
    <div className="app">
      <TabBar projects={projects} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="tab-content">
        {activeTab === 'overview' ? (
          <OverviewTab projects={projects} onOpenProject={setActiveTab} />
        ) : (
          <ProjectTab project={activeProject} />
        )}
      </div>
    </div>
  );
}
