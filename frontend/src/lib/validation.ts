import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { schemas } from '@atlas/contracts';
import type { Contract, SchemaName } from '@atlas/contracts';

const ajv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries(schemas)) ajv.addSchema(schema, name);

export function readContract<Name extends SchemaName>(name: Name, value: unknown): Contract<Name> {
  if (!ajv.getSchema(name)!(value)) throw new Error(`Invalid ${name}`);
  return value as Contract<Name>;
}
