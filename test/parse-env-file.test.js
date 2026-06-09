const os = require('os');
const fs = require('fs');
const path = require('path');
const { parseEnvFile, parseEnvString } = require('../src/parse-env-file');

function tmpFile(content) {
  const p = path.join(os.tmpdir(), `forge-parseenv-${Date.now()}-${Math.random()}.env`);
  fs.writeFileSync(p, content);
  return p;
}

test('returns null for a file that does not exist', () => {
  expect(parseEnvFile('/nonexistent/path/file.env')).toBeNull();
});

test('parses KEY=VALUE pairs into an object', () => {
  const file = tmpFile('SOME_SECRET=abc123\nOTHER_VAR=xyz\n');
  expect(parseEnvFile(file)).toEqual({ SOME_SECRET: 'abc123', OTHER_VAR: 'xyz' });
});

test('ignores lines beginning with #', () => {
  const file = tmpFile('# this is a comment\nKEY=value\n');
  expect(parseEnvFile(file)).toEqual({ KEY: 'value' });
});

test('ignores blank lines', () => {
  const file = tmpFile('\nKEY=value\n\n');
  expect(parseEnvFile(file)).toEqual({ KEY: 'value' });
});

test('strips surrounding double quotes from values', () => {
  const file = tmpFile('KEY="quoted value"\n');
  expect(parseEnvFile(file)).toEqual({ KEY: 'quoted value' });
});

test('strips surrounding single quotes from values', () => {
  const file = tmpFile("KEY='single quoted'\n");
  expect(parseEnvFile(file)).toEqual({ KEY: 'single quoted' });
});

test('preserves = characters inside values', () => {
  const file = tmpFile('KEY=val=ue\n');
  expect(parseEnvFile(file)).toEqual({ KEY: 'val=ue' });
});

test('returns empty object for a file with only comments and blanks', () => {
  const file = tmpFile('# comment\n\n# another\n');
  expect(parseEnvFile(file)).toEqual({});
});

test('parseEnvString returns {} for empty input', () => {
  expect(parseEnvString('')).toEqual({});
});

test('parseEnvString parses KEY=value lines', () => {
  expect(parseEnvString('FOO=bar\nBAZ=qux\n')).toEqual({ FOO: 'bar', BAZ: 'qux' });
});

test('parseEnvString skips blank lines and # comments', () => {
  const src = '# a comment\n\nKEY=value\n# another\nOTHER=thing\n';
  expect(parseEnvString(src)).toEqual({ KEY: 'value', OTHER: 'thing' });
});

test('parseEnvString strips matching single or double quotes', () => {
  const src = 'A="double"\nB=\'single\'\nC=plain\n';
  expect(parseEnvString(src)).toEqual({ A: 'double', B: 'single', C: 'plain' });
});

test('parseEnvString preserves "=" in values', () => {
  expect(parseEnvString('URL=https://example.com/?a=1&b=2\n')).toEqual({ URL: 'https://example.com/?a=1&b=2' });
});
