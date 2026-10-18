import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../runtime/errors.js';

export interface FlightBudget { reserve(): Promise<void> }
/** Single-process only. An exclusive lock makes accidental second writers fail closed. */
export class FileFlightBudget implements FlightBudget {
  constructor(private directory: string, private limit = 900) {}
  async reserve(): Promise<void> {
    let lock;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      lock = await open(join(this.directory, 'lock'), 'wx', 0o600);
      let attempts = 0;
      try {
        const value: unknown = JSON.parse(await readFile(join(this.directory, 'usage.json'), 'utf8'));
        if (!value || typeof value !== 'object' || !('attempts' in value) || !Number.isSafeInteger(value.attempts) || (value.attempts as number) < 0) throw new Error('Invalid ledger');
        attempts = value.attempts as number;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (attempts >= this.limit) throw new AppError('FLIGHT_QUOTA', 'Flight demo request budget exhausted', 503);
      const temp = await open(join(this.directory, 'usage.tmp'), 'w', 0o600);
      try { await temp.writeFile(JSON.stringify({ attempts: attempts + 1 })); await temp.sync(); } finally { await temp.close(); }
      await rename(join(this.directory, 'usage.tmp'), join(this.directory, 'usage.json'));
      const directoryHandle = await open(this.directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('FLIGHT_LEDGER', 'Flight request budget is unavailable', 503);
    } finally {
      if (lock) {
        try { await lock.close(); await unlink(join(this.directory, 'lock')); }
        catch { throw new AppError('FLIGHT_LEDGER', 'Flight request budget is unavailable', 503); }
      }
    }
  }
}
