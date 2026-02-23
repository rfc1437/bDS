import PythonRuntimeWorker from './pythonRuntime.worker?worker';

export function createPythonRuntimeWorker(): Worker {
  return new PythonRuntimeWorker();
}
