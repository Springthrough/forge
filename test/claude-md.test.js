const os = require('os');
const fs = require('fs');
const path = require('path');
const { generateForgeSection, writeClaude, hasForgeSection } = require('../src/cli/claude-md');

let dir;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `forge-claude-md-test-${Date.now()}`);
  fs.mkdirSync(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = {
  processes: [{ name: 'api' }, { name: 'ui' }],
  services: { mongo: {}, redis: {} },
};

test('generateForgeSection includes process names in table', () => {
  const section = generateForgeSection(config);
  expect(section).toContain('| api | `forge logs api` |');
  expect(section).toContain('| ui | `forge logs ui` |');
});

test('generateForgeSection includes service names', () => {
  const section = generateForgeSection(config);
  expect(section).toContain('**Services** (mongo, redis)');
});

test('generateForgeSection omits services section when config has no services', () => {
  const section = generateForgeSection({ processes: [{ name: 'api' }], services: {} });
  expect(section).not.toContain('**Services**');
});

test('generateForgeSection is wrapped in markers', () => {
  const section = generateForgeSection(config);
  expect(section).toContain('<!-- forge:start -->');
  expect(section).toContain('<!-- forge:end -->');
});

test('generateForgeSection handles empty processes array', () => {
  const section = generateForgeSection({ processes: [], services: {} });
  expect(section).toContain('<!-- forge:start -->');
  expect(section).toContain('<!-- forge:end -->');
  expect(section).not.toContain('forge logs');
});

test('hasForgeSection returns false when no CLAUDE.md exists', () => {
  expect(hasForgeSection(dir)).toBe(false);
});

test('hasForgeSection returns false when CLAUDE.md has no forge markers', () => {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project\n\nSome content.\n');
  expect(hasForgeSection(dir)).toBe(false);
});

test('hasForgeSection returns true when forge markers are present', () => {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '<!-- forge:start -->\n## Forge\n<!-- forge:end -->\n');
  expect(hasForgeSection(dir)).toBe(true);
});

test('writeClaude creates CLAUDE.md when none exists', () => {
  writeClaude(dir, config);
  expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true);
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(content).toContain('<!-- forge:start -->');
  expect(content).toContain('forge logs api');
});

test('writeClaude appends forge section to existing CLAUDE.md without markers', () => {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project\n\nSome content.\n');
  writeClaude(dir, config);
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(content).toContain('# My Project');
  expect(content).toContain('<!-- forge:start -->');
  expect(content).toContain('forge logs api');
});

test('writeClaude preserves content above the forge section', () => {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project\n\nSome content.\n');
  writeClaude(dir, config);
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(content.indexOf('# My Project')).toBeLessThan(content.indexOf('<!-- forge:start -->'));
});

test('writeClaude replaces existing forge section — only one marker pair after two writes', () => {
  writeClaude(dir, config);
  writeClaude(dir, config);
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  const count = (content.match(/<!-- forge:start -->/g) ?? []).length;
  expect(count).toBe(1);
});

test('writeClaude updates process list when config changes between writes', () => {
  writeClaude(dir, config);
  writeClaude(dir, { processes: [{ name: 'server' }], services: {} });
  const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(content).toContain('forge logs server');
  expect(content).not.toContain('forge logs api');
});
