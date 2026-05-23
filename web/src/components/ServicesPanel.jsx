export default function ServicesPanel({ services }) {
  const entries = Object.entries(services);
  if (entries.length === 0) return null;

  return (
    <div>
      <div className="section-label">Shared Services</div>
      <div className="services-list">
        {entries.map(([name, info]) => {
          const healthy = info?.status === 'healthy';
          return (
            <div key={name} className="service-row">
              <span>{name}</span>
              <span style={{ color: healthy ? 'var(--green)' : 'var(--text-secondary)' }}>
                ● {info?.status ?? 'unknown'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
