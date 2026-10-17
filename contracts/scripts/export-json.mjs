// Derived build artifacts only; schemas/*.ts remain the sole source of truth.
import { writeFile } from 'node:fs/promises';
import { schemas } from '../dist/index.js';

await Promise.all(Object.entries(schemas).map(([name, schema]) =>
  writeFile(new URL(`../dist/schemas/${name}.json`, import.meta.url), `${JSON.stringify(schema, null, 2)}\n`)
));
