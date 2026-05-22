const os = require('os');
const fs = require('fs');
const path = require('path');

// We test the runInit logic directly (not through commander)
const { runInit } = require('../../src/cli/commands/init');

let projectDir;

beforeEach(() => {
  projectDir = path.join(os.tmpdir(), `forge-init-test-${Date.now()}`);
  fs.mkdirSync(projectDir);
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('creates .forge/config.json in the target directory', async () => {
  await runInit(projectDir);
  expect(fs.existsSync(path.join(projectDir, '.forge', 'config.json'))).toBe(true);
});

test('generated config is valid JSON', async () => {
  await runInit(projectDir);
  const content = fs.readFileSync(path.join(projectDir, '.forge', 'config.json'), 'utf8');
  expect(() => JSON.parse(content)).not.toThrow();
});

test('generated config has required fields', async () => {
  await runInit(projectDir);
  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, '.forge', 'config.json'), 'utf8')
  );
  expect(typeof config.name).toBe('string');
  expect(config.envFile).toBe('.env.forge');
  expect(Array.isArray(config.processes)).toBe(true);
  expect(config.processes.length).toBeGreaterThan(0);
  expect(typeof config.services).toBe('object');
});

test('uses project name from package.json when present', async () => {
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'my-cool-project' })
  );
  await runInit(projectDir);
  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, '.forge', 'config.json'), 'utf8')
  );
  expect(config.name).toBe('my-cool-project');
});

test('falls back to directory name when package.json is absent', async () => {
  await runInit(projectDir);
  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, '.forge', 'config.json'), 'utf8')
  );
  expect(config.name).toBe(path.basename(projectDir));
});

test('throws if .forge/config.json already exists', async () => {
  fs.mkdirSync(path.join(projectDir, '.forge'));
  fs.writeFileSync(path.join(projectDir, '.forge', 'config.json'), '{}');
  await expect(runInit(projectDir)).rejects.toThrow('already exists');
});
