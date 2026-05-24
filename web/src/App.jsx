import { useState } from 'react';
import { useProjects } from './hooks/useProjects.js';
import TabBar from './components/TabBar.jsx';
import OverviewTab from './components/OverviewTab.jsx';
import ProjectTab from './components/ProjectTab.jsx';

export default function App() {
  const projects = useProjects();
  const [activeTab, setActiveTab] = useState('overview');
  const [openTabs, setOpenTabs] = useState([]);

  const openProject = name => {
    setOpenTabs(prev => prev.includes(name) ? prev : [...prev, name]);
    setActiveTab(name);
  };

  const closeTab = name => {
    setOpenTabs(prev => prev.filter(t => t !== name));
    if (activeTab === name) setActiveTab('overview');
  };

  const openProjects = projects.filter(p => openTabs.includes(p.name));
  const activeProject = projects.find(p => p.name === activeTab);

  return (
    <div className="app">
      <TabBar
        projects={openProjects}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onTabClose={closeTab}
      />
      <div className="tab-content">
        {activeTab === 'overview' ? (
          <OverviewTab projects={projects} onOpenProject={openProject} />
        ) : (
          <ProjectTab project={activeProject} />
        )}
      </div>
    </div>
  );
}
