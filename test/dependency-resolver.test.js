const { buildStartOrder } = require('../src/daemon/dependency-resolver');

function waveNames(waves) {
  return waves.map(wave => wave.map(p => p.name).sort());
}

test('no dependsOn: all processes land in wave 0', () => {
  const configs = [
    { name: 'api', command: 'a' },
    { name: 'worker', command: 'b' },
  ];
  const waves = buildStartOrder(configs);
  expect(waves).toHaveLength(1);
  expect(waveNames(waves)[0]).toEqual(['api', 'worker']);
});

test('linear chain: each process in its own wave', () => {
  const configs = [
    { name: 'migrate', command: 'a' },
    { name: 'api', command: 'b', dependsOn: ['migrate'] },
    { name: 'app', command: 'c', dependsOn: ['api'] },
  ];
  expect(waveNames(buildStartOrder(configs))).toEqual([['migrate'], ['api'], ['app']]);
});

test('diamond: shared dep in wave 0, two dependents in wave 1, final in wave 2', () => {
  const configs = [
    { name: 'db', command: 'd' },
    { name: 'api', command: 'a', dependsOn: ['db'] },
    { name: 'ws',  command: 'w', dependsOn: ['db'] },
    { name: 'app', command: 'ap', dependsOn: ['api', 'ws'] },
  ];
  const waves = waveNames(buildStartOrder(configs));
  expect(waves[0]).toEqual(['db']);
  expect(waves[1]).toEqual(['api', 'ws']);
  expect(waves[2]).toEqual(['app']);
});

test('direct cycle throws containing both process names', () => {
  const configs = [
    { name: 'a', command: 'a', dependsOn: ['b'] },
    { name: 'b', command: 'b', dependsOn: ['a'] },
  ];
  expect(() => buildStartOrder(configs)).toThrow(/Cycle detected in dependsOn.*a.*b|Cycle detected in dependsOn.*b.*a/);
});

test('indirect cycle (A→B→C→A) throws', () => {
  const configs = [
    { name: 'a', command: 'a', dependsOn: ['c'] },
    { name: 'b', command: 'b', dependsOn: ['a'] },
    { name: 'c', command: 'c', dependsOn: ['b'] },
  ];
  expect(() => buildStartOrder(configs)).toThrow('Cycle detected in dependsOn');
});

test('unknown dep throws with process name and dep name', () => {
  const configs = [
    { name: 'app', command: 'a', dependsOn: ['nonexistent'] },
  ];
  expect(() => buildStartOrder(configs)).toThrow('Process "app" depends on unknown process "nonexistent"');
});
