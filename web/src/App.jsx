import { useState, useEffect } from 'react';
import { useProjects } from './hooks/useProjects.js';
import TabBar from './components/TabBar.jsx';
import OverviewTab from './components/OverviewTab.jsx';
import ProjectTab from './components/ProjectTab.jsx';

const TABS_KEY = 'forge:open-tabs';
const ACTIVE_KEY = 'forge:active-tab';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export default function App() {
  const projects = useProjects();
  const [activeTab, setActiveTab] = useState(() => readJSON(ACTIVE_KEY, 'overview'));
  const [openTabs, setOpenTabs] = useState(() => readJSON(TABS_KEY, []));

  useEffect(() => { localStorage.setItem(TABS_KEY, JSON.stringify(openTabs)); }, [openTabs]);
  useEffect(() => { localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeTab)); }, [activeTab]);

  // Once the project list has loaded, prune any restored tabs that reference
  // projects that no longer exist. Guard on `length === 0` so the initial
  // pre-fetch render doesn't wipe valid restored tabs.
  useEffect(() => {
    if (projects.length === 0) return;
    const names = new Set(projects.map(p => p.name));
    setOpenTabs(prev => prev.filter(n => names.has(n)));
    setActiveTab(prev => (prev === 'overview' || names.has(prev) ? prev : 'overview'));
  }, [projects]);

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
