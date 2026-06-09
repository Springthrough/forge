const { getServiceImpl } = require('../../src/cli/service');
const launchd = require('../../src/cli/service/launchd');
const systemd = require('../../src/cli/service/systemd');

describe('getServiceImpl', () => {
  test('returns launchd module on darwin', () => {
    expect(getServiceImpl('darwin')).toBe(launchd);
  });

  test('returns systemd module on linux', () => {
    expect(getServiceImpl('linux')).toBe(systemd);
  });

  test('throws on unsupported platform', () => {
    expect(() => getServiceImpl('win32')).toThrow(/not yet support/);
    expect(() => getServiceImpl('aix')).toThrow(/not yet support/);
  });

  test('defaults to process.platform when called with no args', () => {
    const expected = process.platform === 'darwin' ? launchd
                  : process.platform === 'linux'  ? systemd
                  : null;
    if (expected) {
      expect(getServiceImpl()).toBe(expected);
    }
  });
});
