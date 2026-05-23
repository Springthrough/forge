export default function TabBar({ projects, activeTab, onTabChange }) {
  return (
    <nav className="tab-bar">
      <button
        className={`tab${activeTab === 'overview' ? ' tab--active' : ''}`}
        onClick={() => onTabChange('overview')}
      >
        Overview
      </button>
      {projects.map(p => (
        <button
          key={p.name}
          className={`tab${activeTab === p.name ? ' tab--active' : ''}`}
          onClick={() => onTabChange(p.name)}
        >
          {p.name}
        </button>
      ))}
    </nav>
  );
}
