/**
 * Pure-Node helper to resolve the same path as Electron's
 * `app.getPath('userData')` without loading Electron.
 *
 * | Platform | Path                                           |
 * |----------|------------------------------------------------|
 * | macOS    | ~/Library/Application Support/<appName>        |
 * | Windows  | %APPDATA%\<appName>                            |
 * | Linux    | ~/.config/<appName>                            |
 */

import * as os from 'os';
import * as path from 'path';

const APP_NAME = 'Blogging Desktop Server';

export function platformConfigPath(): string {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_NAME);
  }
  if (platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
    return path.join(appData, APP_NAME);
  }
  // Linux and others
  const configDir = process.env['XDG_CONFIG_HOME'] ?? path.join(home, '.config');
  return path.join(configDir, APP_NAME);
}
