export function resolvePyodideIndexURL(workerModuleUrl: string): string {
  return new URL('../../../node_modules/pyodide/', workerModuleUrl).toString();
}
