import { describe, it, expect, vi, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { platformConfigPath } from '../../src/cli/platform';

const APP = 'Blogging Desktop Server';

describe('platformConfigPath', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  it('returns ~/Library/Application Support/<app> on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const home = os.homedir();
    expect(platformConfigPath()).toBe(path.join(home, 'Library', 'Application Support', APP));
  });

  it('returns %APPDATA%/<app> on Windows when APPDATA is set', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env['APPDATA'] = '/mock/AppData/Roaming';
    expect(platformConfigPath()).toBe(path.join('/mock/AppData/Roaming', APP));
  });

  it('falls back to ~/AppData/Roaming/<app> on Windows when APPDATA is unset', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    delete process.env['APPDATA'];
    const home = os.homedir();
    expect(platformConfigPath()).toBe(path.join(home, 'AppData', 'Roaming', APP));
  });

  it('returns ~/.config/<app> on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    delete process.env['XDG_CONFIG_HOME'];
    const home = os.homedir();
    expect(platformConfigPath()).toBe(path.join(home, '.config', APP));
  });

  it('honours XDG_CONFIG_HOME on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env['XDG_CONFIG_HOME'] = '/custom/config';
    expect(platformConfigPath()).toBe(path.join('/custom/config', APP));
  });

  it('treats unknown platforms the same as Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    delete process.env['XDG_CONFIG_HOME'];
    const home = os.homedir();
    expect(platformConfigPath()).toBe(path.join(home, '.config', APP));
  });
});
