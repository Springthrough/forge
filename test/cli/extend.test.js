const os = require('os');
const fs = require('fs');
const path = require('path');
const { inspectDirectory } = require('../../src/cli/commands/extend');

let targetDir;

beforeEach(() => {
  targetDir = path.join(os.tmpdir(), `forge-extend-test-${Date.now()}`);
  fs.mkdirSync(targetDir);
});

afterEach(() => {
  fs.rmSync(targetDir, { recursive: true, force: true });
});

// ── inspectDirectory ──────────────────────────────────────────────────────────

describe('inspectDirectory', () => {
  test('returns config from .forge/config.json when present', () => {
    const config = {
      name: 'sai',
      processes: [{ name: 'api', command: 'npm start', cwd: '.', ports: [3000] }],
      services: { mongo: { db: 'sai' } },
    };
    fs.mkdirSync(path.join(targetDir, '.forge'));
    fs.writeFileSync(path.join(targetDir, '.forge', 'config.json'), JSON.stringify(config));
    expect(inspectDirectory(targetDir)).toEqual(config);
  });

  test('infers config from package.json with start script', () => {
    fs.writeFileSync(
      path.join(targetDir, 'package.json'),
      JSON.stringify({ name: 'my-app', scripts: { start: 'node server.js' } })
    );
    const result = inspectDirectory(targetDir);
    expect(result.name).toBe('my-app');
    expect(result.processes).toHaveLength(1);
    expect(result.processes[0].name).toBe('start');
    expect(result.processes[0].command).toBe('npm start');
    expect(result.processes[0].cwd).toBe('.');
    expect(result.processes[0].ports).toEqual([]);
    expect(result.services).toEqual({});
  });

  test('infers config from package.json with dev script (no start)', () => {
    fs.writeFileSync(
      path.join(targetDir, 'package.json'),
      JSON.stringify({ name: 'my-app', scripts: { dev: 'vite' } })
    );
    const result = inspectDirectory(targetDir);
    expect(result.processes).toHaveLength(1);
    expect(result.processes[0].name).toBe('dev');
    expect(result.processes[0].command).toBe('npm run dev');
    expect(result.processes[0].cwd).toBe('.');
    expect(result.processes[0].ports).toEqual([]);
  });

  test('infers both start and dev when both scripts exist', () => {
    fs.writeFileSync(
      path.join(targetDir, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { start: 'node s.js', dev: 'vite' } })
    );
    const result = inspectDirectory(targetDir);
    expect(result.processes).toHaveLength(2);
    expect(result.processes.map(p => p.name)).toEqual(['start', 'dev']);
  });

  test('falls back to directory name when package.json has no name', () => {
    fs.writeFileSync(
      path.join(targetDir, 'package.json'),
      JSON.stringify({ scripts: { start: 'node s.js' } })
    );
    const result = inspectDirectory(targetDir);
    expect(result.name).toBe(path.basename(targetDir));
  });

  test('returns empty processes when package.json has no relevant scripts', () => {
    fs.writeFileSync(
      path.join(targetDir, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { lint: 'eslint .' } })
    );
    const result = inspectDirectory(targetDir);
    expect(result.processes).toEqual([]);
  });

  test('throws when neither .forge/config.json nor package.json is found', () => {
    expect(() => inspectDirectory(targetDir)).toThrow('No .forge/config.json or package.json found');
  });
});
