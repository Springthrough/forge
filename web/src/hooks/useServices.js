import { useState, useEffect } from 'react';

export function useServices() {
  const [services, setServices] = useState({});
  useEffect(() => {
    let alive = true;
    function poll() {
      fetch('/api/services')
        .then(r => r.json())
        .then(data => {
          if (!alive) return;
          const obj = {};
          for (const svc of (Array.isArray(data) ? data : [])) obj[svc.name] = svc;
          setServices(obj);
        })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return services;
}
