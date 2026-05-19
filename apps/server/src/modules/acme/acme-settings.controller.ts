import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';

const CF_TOKEN_KEY = 'acme.cloudflare.api_token';

const updateConfigSchema = z.object({
  cloudflareApiToken: z.union([z.string().min(1), z.literal(''), z.null()]).optional(),
});
type UpdateConfigBody = z.infer<typeof updateConfigSchema>;

interface ConfigResponse {
  cloudflareTokenSet: boolean;
}

/**
 * Per-feature settings for ACME. Token values are never returned in
 * full; the response only reports whether each secret is set. To
 * clear, send `null` or an empty string.
 *
 * ACME_EMAIL stays env-only in v0.3 (a settings-table override is on
 * the v0.4 roadmap alongside SecretsService).
 */
@Controller('acme/config')
export class AcmeSettingsController {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  @Get()
  async get(): Promise<ConfigResponse> {
    const row = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, CF_TOKEN_KEY))
      .limit(1);
    return { cloudflareTokenSet: !!row[0]?.value };
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
    return this.get();
  }
}
