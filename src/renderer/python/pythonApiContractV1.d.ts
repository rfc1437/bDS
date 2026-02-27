import type { ElectronAPI } from '../../main/shared/electronApi';
type PythonPromiseMethodPath = {
    [Group in keyof ElectronAPI]: ElectronAPI[Group] extends Record<string, (...args: never[]) => unknown> ? {
        [Method in keyof ElectronAPI[Group]]: ElectronAPI[Group][Method] extends (...args: never[]) => Promise<unknown> ? `${Extract<Group, string>}.${Extract<Method, string>}` : never;
    }[keyof ElectronAPI[Group]] : never;
}[keyof ElectronAPI];
export type PythonApiParamType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any' | 'stringOrNull';
export interface PythonApiParamContractV1 {
    name: string;
    type: PythonApiParamType;
    required: boolean;
}
export interface PythonApiMethodContractV1 {
    method: PythonPromiseMethodPath;
    description: string;
    params: PythonApiParamContractV1[];
    returns: string;
}
export interface PythonApiDataStructureFieldContractV1 {
    name: string;
    type: string;
    required: boolean;
    description: string;
}
export interface PythonApiDataStructureContractV1 {
    name: string;
    description: string;
    fields: PythonApiDataStructureFieldContractV1[];
}
export interface PythonApiContractV1 {
    version: string;
    generatedAt: string;
    methods: PythonApiMethodContractV1[];
    dataStructures: PythonApiDataStructureContractV1[];
}
export declare const BDS_PYTHON_API_CONTRACT_V1: PythonApiContractV1;
export declare function listPythonApiMethodNames(): string[];
export declare function getPythonApiMethodContract(methodName: string): PythonApiMethodContractV1 | undefined;
export declare function getPythonApiDataStructureContracts(): PythonApiDataStructureContractV1[];
export {};
//# sourceMappingURL=pythonApiContractV1.d.ts.map