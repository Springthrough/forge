import { useState } from 'react';
import TabBar from './components/TabBar.jsx';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  // projects wired in Task 3 — hardcode one for now to verify tabs render
  const projects = [];

  return (
    <div className="app">
      <TabBar projects={projects} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="tab-content">
        <div className="empty-state">
          Active tab: {activeTab}
        </div>
      </div>
    </div>
  );
}
