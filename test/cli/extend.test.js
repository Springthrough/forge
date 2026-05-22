const os = require('os');
const fs = require('fs');
const path = require('path');
const { inspectDirectory, buildExtendedConfig, runExtend } = require('../../src/cli/commands/extend');

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

// ── buildExtendedConfig ───────────────────────────────────────────────────────

describe('buildExtendedConfig', () => {
  const currentDir = '/projects/myapp';
  const sourceDir  = '/projects/sai';

  const currentConfig = {
    name: 'myapp',
    envFile: '.env.forge',
    processes: [{ name: 'web', command: 'npm start', cwd: '.', ports: [4000] }],
    services: {},
  };

  const sourceConfig = {
    name: 'sai',
    processes: [
      { name: 'api',    command: 'npm start',       cwd: '.',         ports: [3000, 3001] },
      { name: 'worker', command: 'node worker.js',  cwd: 'packages/worker', ports: [] },
    ],
    services: { mongo: { db: 'sai', env: 'DATABASE_URL' } },
  };

  test('prefixes source process names with source project name', () => {
    const result = buildExtendedConfig(currentConfig, sourceConfig, sourceDir, currentDir);
    const names = result.processes.map(p => p.name);
    expect(names).toContain('sai:api');
    expect(names).toContain('sai:worker');
  });

  test('preserves existing processes unchanged', () => {
    const result = buildExtendedConfig(currentConfig, sourceConfig, sourceDir, currentDir);
    expect(result.processes[0]).toEqual(currentConfig.processes[0]);
  });

  test('rebases process cwd relative to currentDir', () => {
    const result = buildExtendedConfig(currentConfig, sourceConfig, sourceDir, currentDir);
    const api = result.processes.find(p => p.name === 'sai:api');
    // sourceDir is /projects/sai, cwd is '.', resolved = /projects/sai
    // relative from /projects/myapp → ../sai
    expect(api.cwd).toBe('../sai');
  });

  test('rebases nested cwd relative to currentDir', () => {
    const result = buildExtendedConfig(currentConfig, sourceConfig, sourceDir, currentDir);
    const worker = result.processes.find(p => p.name === 'sai:worker');
    // resolved = /projects/sai/packages/worker
    // relative from /projects/myapp → ../sai/packages/worker
    expect(worker.cwd).toBe('../sai/packages/worker');
  });

  test('normalizes empty relative path to dot', () => {
    // source and current are the same directory
    const result = buildExtendedConfig(currentConfig, sourceConfig, currentDir, currentDir);
    const api = result.processes.find(p => p.name === 'sai:api');
    expect(api.cwd).toBe('.');
  });

  test('skips source processes whose prefixed name already exists', () => {
    const alreadyHas = {
      ...currentConfig,
      processes: [
        ...currentConfig.processes,
        { name: 'sai:api', command: 'OLD', cwd: '.', ports: [] },
      ],
    };
    const result = buildExtendedConfig(alreadyHas, sourceConfig, sourceDir, currentDir);
    const apiProcesses = result.processes.filter(p => p.name === 'sai:api');
    expect(apiProcesses).toHaveLength(1);
    expect(apiProcesses[0].command).toBe('OLD'); // existing one preserved
  });

  test('merges source services not already in current config', () => {
    const result = buildExtendedConfig(currentConfig, sourceConfig, sourceDir, currentDir);
    expect(result.services.mongo).toEqual({ db: 'sai', env: 'DATABASE_URL' });
  });

  test('current services take precedence over source services on collision', () => {
    const withMongo = {
      ...currentConfig,
      services: { mongo: { db: 'myapp', env: 'DB_URL' } },
    };
    const result = buildExtendedConfig(withMongo, sourceConfig, sourceDir, currentDir);
    expect(result.services.mongo.db).toBe('myapp');
  });

  test('preserves all other current config fields', () => {
    const result = buildExtendedConfig(currentConfig, sourceConfig, sourceDir, currentDir);
    expect(result.name).toBe('myapp');
    expect(result.envFile).toBe('.env.forge');
  });

  test('handles source config with no processes', () => {
    const empty = { name: 'sai', processes: [], services: {} };
    const result = buildExtendedConfig(currentConfig, empty, sourceDir, currentDir);
    expect(result.processes).toEqual(currentConfig.processes);
  });

  test('handles source config with undefined processes', () => {
    const noProcs = { name: 'sai', services: {} };
    const result = buildExtendedConfig(currentConfig, noProcs, sourceDir, currentDir);
    expect(result.processes).toEqual(currentConfig.processes);
  });

  test('handles current config with undefined processes', () => {
    const noCurrent = { name: 'myapp', services: {} };
    const result = buildExtendedConfig(noCurrent, sourceConfig, sourceDir, currentDir);
    expect(result.processes).toHaveLength(2);
  });
});

// ── runExtend (CLI integration) ───────────────────────────────────────────────

describe('runExtend', () => {
  let currentDir;
  let sourceDir2;

  beforeEach(() => {
    currentDir = path.join(os.tmpdir(), `forge-extend-current-${Date.now()}`);
    sourceDir2 = path.join(os.tmpdir(), `forge-extend-source-${Date.now()}`);
    fs.mkdirSync(currentDir);
    fs.mkdirSync(sourceDir2);
  });

  afterEach(() => {
    fs.rmSync(currentDir, { recursive: true, force: true });
    fs.rmSync(sourceDir2, { recursive: true, force: true });
  });

  function writeCurrentConfig(config) {
    fs.mkdirSync(path.join(currentDir, '.forge'), { recursive: true });
    fs.writeFileSync(
      path.join(currentDir, '.forge', 'config.json'),
      JSON.stringify(config, null, 2) + '\n'
    );
  }

  function readCurrentConfig() {
    return JSON.parse(fs.readFileSync(path.join(currentDir, '.forge', 'config.json'), 'utf8'));
  }

  test('appends prefixed processes to current config', async () => {
    writeCurrentConfig({ name: 'myapp', processes: [], services: {} });
    const sourceConfig = {
      name: 'sai',
      processes: [{ name: 'api', command: 'npm start', cwd: '.', ports: [3000] }],
      services: {},
    };
    fs.mkdirSync(path.join(sourceDir2, '.forge'));
    fs.writeFileSync(
      path.join(sourceDir2, '.forge', 'config.json'),
      JSON.stringify(sourceConfig)
    );

    await runExtend(sourceDir2, currentDir);

    const updated = readCurrentConfig();
    expect(updated.processes).toHaveLength(1);
    expect(updated.processes[0].name).toBe('sai:api');
  });

  test('throws when current directory has no .forge/config.json', async () => {
    fs.writeFileSync(
      path.join(sourceDir2, 'package.json'),
      JSON.stringify({ name: 'sai', scripts: { start: 'node s.js' } })
    );
    await expect(runExtend(sourceDir2, currentDir)).rejects.toThrow('.forge/config.json');
  });

  test('throws when target directory has no recognizable config', async () => {
    writeCurrentConfig({ name: 'myapp', processes: [], services: {} });
    await expect(runExtend(sourceDir2, currentDir)).rejects.toThrow(
      'No .forge/config.json or package.json found'
    );
  });

  test('written config is valid JSON', async () => {
    writeCurrentConfig({ name: 'myapp', processes: [], services: {} });
    fs.writeFileSync(
      path.join(sourceDir2, 'package.json'),
      JSON.stringify({ name: 'sai', scripts: { start: 'node s.js' } })
    );

    await runExtend(sourceDir2, currentDir);

    const raw = fs.readFileSync(path.join(currentDir, '.forge', 'config.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
