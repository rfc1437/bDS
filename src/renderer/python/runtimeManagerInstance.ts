import { PythonRuntimeManager } from './PythonRuntimeManager';

const runtimeManager = new PythonRuntimeManager();

export function getPythonRuntimeManager(): PythonRuntimeManager {
  return runtimeManager;
}
