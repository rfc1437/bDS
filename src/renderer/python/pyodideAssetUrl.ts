export function resolvePyodideIndexURL(workerModuleUrl: string): string | undefined {
  const parsed = new URL(workerModuleUrl);

  if (parsed.protocol !== 'file:') {
    return undefined;
  }

  return new URL('../../../node_modules/pyodide/', workerModuleUrl).toString();
}
