import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('package.json packaging configuration', () => {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, any>;

  it('defines cross-platform distribution scripts', () => {
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts['dist']).toBeTypeOf('string');
    expect(scripts['dist:mac']).toBeTypeOf('string');
    expect(scripts['dist:win']).toBeTypeOf('string');
    expect(scripts['dist:linux']).toBeTypeOf('string');
  });

  it('registers bds protocol for packaged apps', () => {
    const build = packageJson.build as Record<string, any>;
    const protocols = build.protocols as Array<{ name: string; schemes: string[] }>;

    expect(Array.isArray(protocols)).toBe(true);
    expect(protocols.some((entry) => Array.isArray(entry.schemes) && entry.schemes.includes('bds'))).toBe(true);
  });

  it('configures macOS, Windows, and Linux targets', () => {
    const build = packageJson.build as Record<string, any>;

    expect(build.mac).toBeTruthy();
    expect(build.win).toBeTruthy();
    expect(build.linux).toBeTruthy();

    expect(build.mac.target).toBeTruthy();
    expect(build.win.target).toBeTruthy();
    expect(build.linux.target).toBeTruthy();
  });

  it('keeps runtime modules in dependencies (not devDependencies)', () => {
    const dependencies = packageJson.dependencies as Record<string, string>;
    const devDependencies = packageJson.devDependencies as Record<string, string>;

    expect(dependencies.uuid).toBeTypeOf('string');
    expect(devDependencies.uuid).toBeUndefined();
  });
});
