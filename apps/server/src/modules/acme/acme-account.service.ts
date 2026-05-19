import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AcmeAccount } from '../../database/schema';

/**
 * Phase 4 fills this in. Stub raises `NOT_IMPLEMENTED_YET` so any caller
 * that wires up too early gets a clear signal at runtime instead of a
 * misleading silent fallback.
 */
@Injectable()
export class AcmeAccountService {
  ensureAccount(_directoryUrl: string, _email: string): Promise<AcmeAccount> {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 4,
    });
  }
}
