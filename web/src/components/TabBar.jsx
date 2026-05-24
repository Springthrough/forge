export default function TabBar({ projects, activeTab, onTabChange, onTabClose }) {
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
          <span
            className="tab__close"
            onClick={e => { e.stopPropagation(); onTabClose(p.name); }}
          >
            ✕
          </span>
        </button>
      ))}
    </nav>
  );
}
