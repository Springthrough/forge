import { useState, useEffect } from 'react';

export function useProjects() {
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    let alive = true;
    function poll() {
      fetch('/api/projects')
        .then(r => r.json())
        .then(data => { if (alive) setProjects(data); })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return projects;
}
