import { useState } from 'react';
import { useProjects } from './hooks/useProjects.js';
import TabBar from './components/TabBar.jsx';
import OverviewTab from './components/OverviewTab.jsx';

export default function App() {
  const projects = useProjects();
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="app">
      <TabBar projects={projects} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="tab-content">
        {activeTab === 'overview' ? (
          <OverviewTab projects={projects} onOpenProject={setActiveTab} />
        ) : (
          <div className="empty-state">Project tab — Task 5</div>
        )}
      </div>
    </div>
  );
}
