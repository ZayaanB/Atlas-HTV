import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError } from './errors.js';
// Both src/runtime and dist/runtime are two levels below backend/.
export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const repoRoot = resolve(backendRoot,'..');
export async function loadLocalModule(path: string | undefined, allowed: string[]): Promise<Record<string,unknown> | undefined> {
  if (!path) return;
  const filename = await realpath(resolve(repoRoot,path));
  if (!allowed.some(root => {
    const rel = relative(resolve(repoRoot,root),filename);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  })) throw new AppError('CONFIG_INVALID','Integration modules must stay within their owned repository paths',500);
  return import(pathToFileURL(filename).href) as Promise<Record<string,unknown>>;
}
