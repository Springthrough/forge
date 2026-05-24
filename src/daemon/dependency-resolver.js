function buildStartOrder(processConfigs) {
  const byName = new Map(processConfigs.map(p => [p.name, p]));

  for (const proc of processConfigs) {
    for (const dep of proc.dependsOn ?? []) {
      if (!byName.has(dep)) {
        throw new Error(`Process "${proc.name}" depends on unknown process "${dep}"`);
      }
    }
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(processConfigs.map(p => [p.name, WHITE]));
  const stack = [];

  function dfs(name) {
    color.set(name, GRAY);
    stack.push(name);
    for (const dep of byName.get(name)?.dependsOn ?? []) {
      if (color.get(dep) === GRAY) {
        const idx = stack.indexOf(dep);
        const cycle = [...stack.slice(idx), dep];
        throw new Error(`Cycle detected in dependsOn: ${cycle.join(' → ')}`);
      }
      if (color.get(dep) === WHITE) dfs(dep);
    }
    stack.pop();
    color.set(name, BLACK);
  }

  for (const proc of processConfigs) {
    if (color.get(proc.name) === WHITE) dfs(proc.name);
  }

  const waves = [];
  const placed = new Set();
  while (placed.size < processConfigs.length) {
    const wave = processConfigs.filter(p =>
      !placed.has(p.name) && (p.dependsOn ?? []).every(d => placed.has(d))
    );
    waves.push(wave);
    for (const p of wave) placed.add(p.name);
  }

  return waves;
}

module.exports = { buildStartOrder };
