import { z } from 'zod';

export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const languageSchema = z.enum(['zh-TW', 'en']);
export type Language = z.infer<typeof languageSchema>;

export const panelSettingsSchema = z.object({
  language: languageSchema.default('zh-TW'),
  theme: themeSchema.default('system'),
  sidebarCollapsed: z.boolean().default(false),
});
export type PanelSettings = z.infer<typeof panelSettingsSchema>;

export const updateSettingsSchema = panelSettingsSchema.partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const aboutInfoSchema = z.object({
  version: z.string(),
  nodeVersion: z.string(),
  platform: z.string(),
  arch: z.string(),
  installPath: z.string(),
  license: z.string(),
});
export type AboutInfo = z.infer<typeof aboutInfoSchema>;
