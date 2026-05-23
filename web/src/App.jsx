import { useState } from 'react';
import { useProjects } from './hooks/useProjects.js';
import TabBar from './components/TabBar.jsx';

export default function App() {
  const projects = useProjects();
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="app">
      <TabBar projects={projects} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="tab-content">
        <div className="empty-state">
          Active tab: {activeTab} — {projects.length} project(s) loaded
        </div>
      </div>
    </div>
  );
}
