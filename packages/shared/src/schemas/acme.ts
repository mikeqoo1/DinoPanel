import { z } from 'zod';

export const acmeChallengeSchema = z.enum(['http-01', 'dns-01']);
export type AcmeChallenge = z.infer<typeof acmeChallengeSchema>;

export const acmeDnsProviderSchema = z.enum(['cloudflare']);
export type AcmeDnsProvider = z.infer<typeof acmeDnsProviderSchema>;

export const acmeOrderStatusSchema = z.enum(['pending', 'success', 'failed']);
export type AcmeOrderStatus = z.infer<typeof acmeOrderStatusSchema>;

export const acmeIssueRequestSchema = z
  .object({
    challenge: acmeChallengeSchema,
    dnsProvider: acmeDnsProviderSchema.optional(),
  })
  .refine(
    (v) => v.challenge !== 'dns-01' || v.dnsProvider !== undefined,
    {
      message: 'dns-01 challenge requires a dnsProvider',
      path: ['dnsProvider'],
    },
  );
export type AcmeIssueRequest = z.infer<typeof acmeIssueRequestSchema>;

export const acmeStatusResponseSchema = z.object({
  hasCert: z.boolean(),
  expiresAt: z.number().int().nullable(),
  lastIssuedAt: z.number().int().nullable(),
  lastError: z.string().nullable(),
});
export type AcmeStatusResponse = z.infer<typeof acmeStatusResponseSchema>;

export const acmeOrderResponseSchema = z.object({
  id: z.number().int(),
  siteId: z.number().int(),
  challenge: acmeChallengeSchema,
  status: acmeOrderStatusSchema,
  errorMessage: z.string().nullable(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
});
export type AcmeOrderResponse = z.infer<typeof acmeOrderResponseSchema>;
