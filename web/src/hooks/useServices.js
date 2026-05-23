import { useState, useEffect } from 'react';

export function useServices() {
  const [services, setServices] = useState({});
  useEffect(() => {
    let alive = true;
    function poll() {
      fetch('/api/services')
        .then(r => r.json())
        .then(data => { if (alive) setServices(data); })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return services;
}
