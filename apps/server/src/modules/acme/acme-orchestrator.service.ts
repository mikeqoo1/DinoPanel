import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  AcmeChallenge,
  AcmeDnsProvider,
  AcmeStatusResponse,
  SiteCertInfo,
} from '@dinopanel/shared';

export interface IssueArgs {
  siteId: number;
  domains: string[];
  challenge: AcmeChallenge;
  dnsProvider?: AcmeDnsProvider;
}

export interface IssueResult {
  cert: SiteCertInfo;
  expiresAt: number;
}

/**
 * Phase 4 owns the real implementation (HTTP-01 + Cloudflare DNS-01 +
 * cert file write + sites.cert_paths update + reload). Phase 1 keeps a
 * stub so the controller and scheduler-glue surfaces compile.
 */
@Injectable()
export class AcmeOrchestratorService {
  issue(_args: IssueArgs): Promise<IssueResult> {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 4,
    });
  }

  renew(_siteId: number): Promise<IssueResult> {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 4,
    });
  }

  status(_siteId: number): Promise<AcmeStatusResponse> {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 4,
    });
  }
}
