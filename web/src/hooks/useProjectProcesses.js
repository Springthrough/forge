import { useState, useEffect } from 'react';

export function useProjectProcesses(projectName) {
  const [processes, setProcesses] = useState([]);
  useEffect(() => {
    if (!projectName) return;
    let alive = true;
    function poll() {
      fetch(`/api/projects/${encodeURIComponent(projectName)}/processes`)
        .then(r => r.json())
        .then(data => { if (alive) setProcesses(data.processes ?? []); })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [projectName]);
  return processes;
}
