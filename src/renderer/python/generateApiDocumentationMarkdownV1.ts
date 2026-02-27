import {
  BDS_PYTHON_API_CONTRACT_V1,
  type PythonApiDataStructureContractV1,
  type PythonApiParamContractV1,
} from '../../main/shared/pythonApiContractV1';

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function toDocumentationHeadingSlug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function toPythonTypeName(type: PythonApiParamContractV1['type']): string {
  switch (type) {
    case 'string':
      return 'str';
    case 'number':
      return 'int | float';
    case 'boolean':
      return 'bool';
    case 'object':
      return 'dict';
    case 'array':
      return 'list';
    case 'stringOrNull':
      return 'str | None';
    case 'any':
    default:
      return 'Any';
  }
}

function sampleValueForParam(param: PythonApiParamContractV1): string {
  const snakeName = toSnakeCase(param.name);

  switch (param.type) {
    case 'string':
      if (snakeName.includes('id')) {
        return `'${snakeName.replace(/_id$/, '')}-1'`;
      }
      if (snakeName.includes('query')) {
        return `'search phrase'`;
      }
      return `'${snakeName}'`;
    case 'number':
      return '10';
    case 'boolean':
      return 'True';
    case 'object':
      return '{}';
    case 'array':
      return '[]';
    case 'stringOrNull':
      return 'None';
    case 'any':
    default:
      return 'None';
  }
}

function buildExampleCall(namespace: string, method: string, params: PythonApiParamContractV1[]): string {
  const pythonMethod = toSnakeCase(method);
  const requiredParams = params.filter((param) => param.required);

  if (requiredParams.length === 0) {
    return `result = await bds.${namespace}.${pythonMethod}()`;
  }

  const args = requiredParams
    .map((param) => `${toSnakeCase(param.name)}=${sampleValueForParam(param)}`)
    .join(', ');

  return `result = await bds.${namespace}.${pythonMethod}(${args})`;
}

function buildResponseExample(returnsType: string): string {
  const value = returnsType.trim();

  if (value === 'boolean') {
    return 'True';
  }

  if (value === 'void') {
    return 'None';
  }

  if (value.endsWith('[]') || value.startsWith('Array<')) {
    return '[]';
  }

  if (value.includes(' | null')) {
    return 'None  # or dict-like object when found';
  }

  if (value === 'string') {
    return "'value'";
  }

  return '{}';
}

function extractDataStructureNames(typeSignature: string): string[] {
  const matches = typeSignature.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];
  const names = matches.filter((name) =>
    BDS_PYTHON_API_CONTRACT_V1.dataStructures.some((entry) => entry.name === name)
  );

  return [...new Set(names)];
}

function sampleValueForField(type: string): string {
  const normalized = type.trim();

  if (normalized.includes('string')) {
    return "'value'";
  }

  if (normalized.includes('number')) {
    return '0';
  }

  if (normalized.includes('boolean')) {
    return 'False';
  }

  if (normalized.includes('[]')) {
    return '[]';
  }

  if (normalized.includes('object') || normalized.includes('Record<')) {
    return '{}';
  }

  return 'None';
}

function buildDataStructureExample(structure: PythonApiDataStructureContractV1): string {
  const lines: string[] = ['{'];

  structure.fields.forEach((field, index) => {
    const comma = index < structure.fields.length - 1 ? ',' : '';
    lines.push(`    '${field.name}': ${sampleValueForField(field.type)}${comma}`);
  });

  lines.push('}');
  return lines.join('\n');
}

function buildResponseExampleWithStructure(returnsType: string): string {
  const structureNames = extractDataStructureNames(returnsType);

  if (structureNames.length > 0) {
    const structure = BDS_PYTHON_API_CONTRACT_V1.dataStructures.find((entry) => entry.name === structureNames[0]);
    if (structure) {
      if (returnsType.includes('[]') || returnsType.startsWith('Array<')) {
        return `[\n${buildDataStructureExample(structure)}\n]`;
      }

      if (returnsType.includes(' | null')) {
        return `None  # or\n${buildDataStructureExample(structure)}`;
      }

      return buildDataStructureExample(structure);
    }
  }

  return buildResponseExample(returnsType);
}

export function generateApiDocumentationMarkdownV1(): string {
  const sections: string[] = [];
  const namespaceOrder: string[] = [];
  const grouped = new Map<string, typeof BDS_PYTHON_API_CONTRACT_V1.methods>();

  for (const method of BDS_PYTHON_API_CONTRACT_V1.methods) {
    const [namespace] = method.method.split('.');
    if (!namespace) {
      continue;
    }

    if (!grouped.has(namespace)) {
      grouped.set(namespace, []);
      namespaceOrder.push(namespace);
    }

    grouped.get(namespace)?.push(method);
  }

  sections.push('# API Documentation');
  sections.push('');
  sections.push(`Contract version: ${BDS_PYTHON_API_CONTRACT_V1.version}`);
  sections.push('');
  sections.push('This reference documents all Python runtime API calls available through `bds_api` in embedded Pyodide.');
  sections.push('');
  sections.push('`bds_api` is available in both **macro scripts** (executed during preview and page generation) and **transform scripts** (executed during blogmark import). In macro entrypoints, API calls run in the same runtime context as the macro and can be used to fetch posts, media, tags, or other application data.');
  sections.push('');
  sections.push('## Usage');
  sections.push('');
  sections.push('```python');
  sections.push('from bds_api import bds');
  sections.push('');
  sections.push('# inside an async Python function in bDS runtime:');
  sections.push("project = await bds.meta.get_project_metadata()");
  sections.push('```');
  sections.push('');
  sections.push('## Table of contents');
  sections.push('');

  for (const namespace of namespaceOrder) {
    const moduleAnchor = toDocumentationHeadingSlug(namespace);
    sections.push(`- [${namespace}](#${moduleAnchor})`);
  }

  sections.push('- [Data Structures](#data-structures)');

  for (const namespace of namespaceOrder) {
    const namespaceMethods = grouped.get(namespace) ?? [];
    sections.push('');
    sections.push(`## ${namespace}`);
    sections.push('');
    sections.push('**Module APIs**');
    sections.push('');

    for (const method of namespaceMethods) {
      const apiAnchor = toDocumentationHeadingSlug(method.method);
      sections.push(`- [${method.method}](#${apiAnchor})`);
    }

    for (const method of namespaceMethods) {
      const [, member] = method.method.split('.');
      if (!member) {
        continue;
      }

      sections.push('');
      sections.push(`### ${method.method}`);
      sections.push('');
      sections.push(method.description);
      sections.push('');
      sections.push('**Parameters**');
      sections.push('');

      if (method.params.length === 0) {
        sections.push('- None');
      } else {
        for (const param of method.params) {
          const requiredState = param.required ? 'required' : 'optional';
          sections.push(`- ${param.name} (${toPythonTypeName(param.type)}, ${requiredState})`);
        }
      }

      sections.push('');
      sections.push('**Response specification**');
      sections.push('');
      sections.push(`- Return type: \`${method.returns}\``);

      if (method.returns.includes(' | null')) {
        sections.push('- Nullability: Returns `None` when no matching value exists.');
      }

      const referencedStructures = extractDataStructureNames(method.returns);
      if (referencedStructures.length > 0) {
        sections.push(`- Data structures: ${referencedStructures.map((name) => `\`${name}\``).join(', ')}`);
      }

      sections.push('');
      sections.push('**Example call**');
      sections.push('');
      sections.push('```python');
      sections.push('from bds_api import bds');
      sections.push(buildExampleCall(namespace, member, method.params));
      sections.push('```');
      sections.push('');
      sections.push('**Example response**');
      sections.push('');
      sections.push('```python');
      sections.push(buildResponseExampleWithStructure(method.returns));
      sections.push('```');
    }

    sections.push('');
    sections.push('[↑ Back to Table of contents](#table-of-contents)');
  }

  sections.push('');
  sections.push('## Data Structures');
  sections.push('');
  sections.push('Shared structures referenced by response types are defined once here.');

  for (const structure of BDS_PYTHON_API_CONTRACT_V1.dataStructures) {
    sections.push('');
    sections.push(`### ${structure.name}`);
    sections.push('');
    sections.push(structure.description);
    sections.push('');
    sections.push('**Fields**');
    sections.push('');

    for (const field of structure.fields) {
      const requiredState = field.required ? 'required' : 'optional';
      sections.push(`- ${field.name} (\`${field.type}\`, ${requiredState}): ${field.description}`);
    }

    sections.push('');
    sections.push('[↑ Back to Table of contents](#table-of-contents)');
  }

  sections.push('');
  sections.push('---');
  sections.push('');
  sections.push(`Generated from contract at ${BDS_PYTHON_API_CONTRACT_V1.generatedAt}.`);
  sections.push('');

  return `${sections.join('\n').trim()}\n`;
}