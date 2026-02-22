import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const assetsDir = path.join(projectRoot, 'assets');
const sourceSvgPath = path.join(assetsDir, 'icon.svg');
const outputPngPath = path.join(assetsDir, 'icon.png');
const outputIcnsPath = path.join(assetsDir, 'icon.icns');
const outputIcoPath = path.join(assetsDir, 'icon.ico');
const legacyIconsetPath = path.join(assetsDir, 'icon.iconset');

const icnsBaseSizes = [16, 32, 128, 256, 512];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function writeBasePng() {
  await sharp(sourceSvgPath)
    .resize(1024, 1024, { fit: 'contain' })
    .png()
    .toFile(outputPngPath);
}

async function writeIconsetPngs(iconsetDir) {
  for (const size of icnsBaseSizes) {
    const oneX = path.join(iconsetDir, `icon_${size}x${size}.png`);
    const twoX = path.join(iconsetDir, `icon_${size}x${size}@2x.png`);

    await sharp(outputPngPath).resize(size, size).png().toFile(oneX);
    await sharp(outputPngPath).resize(size * 2, size * 2).png().toFile(twoX);
  }
}

async function writeIcns(iconsetDir) {
  await runCommand('iconutil', ['-c', 'icns', iconsetDir, '-o', outputIcnsPath]);
}

async function writeIco(tmpDir) {
  const icoPngPaths = [];

  for (const size of icoSizes) {
    const sizedPngPath = path.join(tmpDir, `ico-${size}.png`);
    await sharp(outputPngPath).resize(size, size).png().toFile(sizedPngPath);
    icoPngPaths.push(sizedPngPath);
  }

  const icoBuffer = await pngToIco(icoPngPaths);
  await fs.writeFile(outputIcoPath, icoBuffer);
}

async function ensurePrerequisites() {
  if (!(await exists(sourceSvgPath))) {
    throw new Error(`Source SVG not found: ${sourceSvgPath}`);
  }

  if (process.platform !== 'darwin') {
    throw new Error('ICNS generation requires macOS (iconutil). Run this script on macOS.');
  }
}

async function cleanLegacyIntermediates() {
  if (await exists(legacyIconsetPath)) {
    await fs.rm(legacyIconsetPath, { recursive: true, force: true });
  }
}

async function main() {
  await ensurePrerequisites();
  await cleanLegacyIntermediates();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bds-icon-gen-'));
  const tmpIconsetDir = path.join(tmpDir, 'icon.iconset');

  try {
    await fs.mkdir(tmpIconsetDir, { recursive: true });

    console.log('[icons] Generating 1024x1024 PNG from SVG...');
    await writeBasePng();

    console.log('[icons] Generating iconset PNG variants...');
    await writeIconsetPngs(tmpIconsetDir);

    console.log('[icons] Building ICNS with iconutil...');
    await writeIcns(tmpIconsetDir);

    console.log('[icons] Building ICO multi-size bundle...');
    await writeIco(tmpDir);

    console.log('[icons] Done: assets/icon.png, assets/icon.icns, assets/icon.ico');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await cleanLegacyIntermediates();
  }
}

main().catch((error) => {
  console.error('[icons] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
