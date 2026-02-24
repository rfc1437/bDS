import { getPythonApiMethodContract, type PythonApiParamContractV1 } from './pythonApiContractV1';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getElectronApi(): Window['electronAPI'] {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('electronAPI is not available in renderer context');
  }
  return window.electronAPI;
}

function validateParamValue(methodName: string, param: PythonApiParamContractV1, value: unknown): void {
  if (param.type === 'stringOrNull') {
    if (value === null || (typeof value === 'string' && value.length > 0)) {
      return;
    }
    throw new Error(`${methodName} requires stringOrNull arg ${param.name}`);
  }

  if (value === undefined || value === null) {
    if (!param.required) {
      return;
    }
    throw new Error(`${methodName} requires ${param.type} arg ${param.name}`);
  }

  if (param.type === 'any') {
    return;
  }

  if (param.type === 'string') {
    if (typeof value === 'string' && value.length > 0) {
      return;
    }
    throw new Error(`${methodName} requires string arg ${param.name}`);
  }

  if (param.type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return;
    }
    throw new Error(`${methodName} requires number arg ${param.name}`);
  }

  if (param.type === 'boolean') {
    if (typeof value === 'boolean') {
      return;
    }
    throw new Error(`${methodName} requires boolean arg ${param.name}`);
  }

  if (param.type === 'array') {
    if (Array.isArray(value)) {
      return;
    }
    throw new Error(`${methodName} requires array arg ${param.name}`);
  }

  if (param.type === 'object') {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return;
    }
    throw new Error(`${methodName} requires object arg ${param.name}`);
  }
}

export async function invokePythonApiMethodV1(method: string, args: unknown): Promise<unknown> {
  const contract = getPythonApiMethodContract(method);
  if (!contract) {
    throw new Error(`Unsupported Python API method: ${method}`);
  }

  const normalizedArgs = asRecord(args);
  const electronApi = getElectronApi();
  const [namespace, member] = contract.method.split('.');
  if (!namespace || !member) {
    throw new Error(`Unsupported Python API method: ${method}`);
  }

  const namespaceRecord = (electronApi as unknown as Record<string, unknown>)[namespace];
  if (!namespaceRecord || typeof namespaceRecord !== 'object') {
    throw new Error(`Unsupported Python API namespace: ${namespace}`);
  }

  const callable = (namespaceRecord as Record<string, unknown>)[member];
  if (typeof callable !== 'function') {
    throw new Error(`Unsupported Python API method: ${method}`);
  }

  const orderedArgs = contract.params.map((param) => {
    const value = normalizedArgs[param.name];
    validateParamValue(contract.method, param, value);
    return value;
  });

  return (callable as (...values: unknown[]) => Promise<unknown>)(...orderedArgs);
}