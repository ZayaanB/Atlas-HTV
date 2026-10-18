import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError } from './errors.js';
// Both src/runtime and dist/runtime are two levels below backend/.
export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const repoRoot = resolve(backendRoot,'..');
export async function loadLocalModule(path: string | undefined, allowed: string[], root = repoRoot): Promise<Record<string,unknown> | undefined> {
  if (!path) return;
  let filename: string;
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(root); filename = await realpath(resolve(canonicalRoot,path)); }
  catch { throw new AppError('HANDOFF_MODULE_UNAVAILABLE','Configured handoff module could not be found or read',500); }
  if (!allowed.some(rootPath => {
    const rel = relative(resolve(canonicalRoot,rootPath),filename);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  })) throw new AppError('CONFIG_INVALID','Integration modules must stay within their owned repository paths',500);
  if (!/\.m?js$/.test(filename)) throw new AppError('CONFIG_INVALID','Use portable .mjs or built .js handoff modules',500);
  try { return await import(pathToFileURL(filename).href) as Record<string,unknown>; }
  catch { throw new AppError('HANDOFF_MODULE_INVALID','Configured handoff module could not be imported',500); }
}
