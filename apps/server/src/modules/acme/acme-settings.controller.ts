import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';

const CF_TOKEN_KEY = 'acme.cloudflare.api_token';
const EMAIL_KEY = 'acme.email';

const updateConfigSchema = z.object({
  cloudflareApiToken: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
  // v0.4 carry-over: settings override for ACME_EMAIL. Empty string /
  // null clears the settings row, falling back to env (or no email at
  // all → ACME_EMAIL_MISSING when issuance attempts to run).
  email: z.union([z.string().email(), z.literal(''), z.null()]).optional(),
});
type UpdateConfigBody = z.infer<typeof updateConfigSchema>;

interface ConfigResponse {
  cloudflareTokenSet: boolean;
  // Resolved email (env wins; null when neither env nor settings provide one).
  email: string | null;
  emailSource: 'env' | 'settings' | 'unset';
}

/**
 * Per-feature settings for ACME. Token values are never returned in
 * full; the response only reports whether each secret is set. To
 * clear, send `null` or an empty string.
 *
 * v0.4: ACME_EMAIL moved from env-only to env-first + settings
 * fallback (decisions.md Q4 carry-over from v0.3).
 */
@Controller('acme/config')
export class AcmeSettingsController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(ConfigService)
    private readonly config: ConfigService<{ app: AppConfig }>,
  ) {}

  @Get()
  async get(): Promise<ConfigResponse> {
    const cf = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, CF_TOKEN_KEY))
      .limit(1);
    const resolved = await this.resolveEmail();
    return {
      cloudflareTokenSet: !!cf[0]?.value,
      email: resolved.email,
      emailSource: resolved.source,
    };
  }

  @Put()
  async update(
    @Body(new ZodValidationPipe(updateConfigSchema)) body: UpdateConfigBody,
  ): Promise<ConfigResponse> {
    if (body.cloudflareApiToken !== undefined) {
      const value = body.cloudflareApiToken;
      if (value === null || value === '') {
        await this.db.delete(settings).where(eq(settings.key, CF_TOKEN_KEY));
      } else {
        const now = Date.now();
        await this.db
          .insert(settings)
          .values({ key: CF_TOKEN_KEY, value, updatedAt: now })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value, updatedAt: now },
          });
      }
    }
    if (body.email !== undefined) {
      const value = body.email;
      if (value === null || value === '') {
        await this.db.delete(settings).where(eq(settings.key, EMAIL_KEY));
      } else {
        const now = Date.now();
        await this.db
          .insert(settings)
          .values({ key: EMAIL_KEY, value, updatedAt: now })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value, updatedAt: now },
          });
      }
    }
    return this.get();
  }

  private async resolveEmail(): Promise<{
    email: string | null;
    source: 'env' | 'settings' | 'unset';
  }> {
    const app = this.config.get<AppConfig>('app', { infer: true });
    const envEmail = app?.env.ACME_EMAIL.trim();
    if (envEmail) return { email: envEmail, source: 'env' };
    const row = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, EMAIL_KEY))
      .limit(1);
    const settingsEmail = row[0]?.value?.trim();
    if (settingsEmail) return { email: settingsEmail, source: 'settings' };
    return { email: null, source: 'unset' };
  }
}
