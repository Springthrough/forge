const path = require('path');
const { runEnvCommand } = require('../src/daemon/decrypt-env');

const NODE = process.execPath;

test('returns ok: false with explanatory error when argv is empty', async () => {
  const result = await runEnvCommand([], process.cwd(), 1000);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/non-empty array/);
});

test('parses KEY=value lines from stdout on success', async () => {
  const script = "process.stdout.write('FOO=bar\\nBAZ=qux\\n')";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(true);
  expect(result.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
});

test('handles comments and quoted values', async () => {
  const script = "process.stdout.write('# comment\\nA=\"quoted\"\\nB=plain\\n')";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(true);
  expect(result.env).toEqual({ A: 'quoted', B: 'plain' });
});

test('reports non-zero exit with captured stderr', async () => {
  const script = "process.stderr.write('boom\\n'); process.exit(7)";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/exit 7/);
  expect(result.error).toMatch(/boom/);
});

test('reports timeout when the command exceeds the budget', async () => {
  const script = "setInterval(() => {}, 60000)";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 200);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/timeout/);
});

test('reports failure when stdout has no parseable entries', async () => {
  const script = "";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/no entries/);
});

test('inherits parent process.env (so PATH / agents are visible to the child)', async () => {
  const script = "process.stdout.write('HOME_PRESENT=' + (process.env.HOME ? 'yes' : 'no') + '\\n')";
  const result = await runEnvCommand([NODE, '-e', script], process.cwd(), 5000);
  expect(result.ok).toBe(true);
  expect(result.env.HOME_PRESENT).toBe('yes');
});
