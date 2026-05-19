import { Injectable } from '@nestjs/common';
import * as acme from 'acme-client';

/**
 * Minimal opaque types — acme-client's full RFC 8555 types aren't
 * re-exported at the top level, so we keep these as `unknown` from
 * our side and only reach into them in the few places we need to
 * (challenge.type, challenge.token, authz.identifier.value).
 */
export interface AcmeAuthorization {
  identifier?: { value?: string };
}
export interface AcmeChallengeObj {
  type: string;
  token: string;
}

export interface AcmeClient {
  createAccount(opts: { contact: string[]; termsOfServiceAgreed: boolean }): Promise<unknown>;
  auto(opts: {
    csr: Buffer;
    challengeCreateFn: (
      authz: AcmeAuthorization,
      challenge: AcmeChallengeObj,
      keyAuthorization: string,
    ) => Promise<unknown>;
    challengeRemoveFn: (
      authz: AcmeAuthorization,
      challenge: AcmeChallengeObj,
      keyAuthorization: string,
    ) => Promise<unknown>;
    email?: string;
    termsOfServiceAgreed?: boolean;
    challengePriority?: string[];
  }): Promise<string>;
}

export interface AcmeCrypto {
  createPrivateRsaKey(keySize?: number): Promise<Buffer>;
  createCsr(
    data: { commonName: string; altNames?: string[] },
    keyPem?: Buffer | string,
  ): Promise<[Buffer, Buffer]>;
  readCertificateInfo(certPem: string): {
    notAfter: Date;
    domains: { commonName: string; altNames: string[] };
  };
}

/**
 * Thin wrapper so tests can swap out the actual ACME library. The
 * production factory returns the real `acme-client`; test factories
 * return fakes (`__tests__/acme.test.ts`).
 */
@Injectable()
export class AcmeClientFactory {
  createClient(directoryUrl: string, accountKey: Buffer): AcmeClient {
    return new acme.Client({ directoryUrl, accountKey }) as unknown as AcmeClient;
  }

  crypto(): AcmeCrypto {
    return acme.crypto as unknown as AcmeCrypto;
  }
}

export const ACME_CLIENT_FACTORY = Symbol('ACME_CLIENT_FACTORY');
