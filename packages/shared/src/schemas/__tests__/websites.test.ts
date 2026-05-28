import { describe, it, expect } from 'vitest';
import { staticSitePayloadSchema, phpPayloadSchema } from '../websites';

// Minimal valid base objects (all other fields use schema defaults).
const staticBase = { type: 'static' as const };
const phpBase = { type: 'php' as const };

// Helpers
function nineItems() {
  return Array.from({ length: 9 }, (_, i) => `file${i}.html`);
}

// ---------------------------------------------------------------------------
// staticSitePayloadSchema — indexFiles
// ---------------------------------------------------------------------------

describe('staticSitePayloadSchema — indexFiles', () => {
  it('passes with a single valid filename', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: ['index.html'],
    });
    expect(result.success).toBe(true);
  });

  it('passes with two valid filenames', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: ['index.html', 'home.htm'],
    });
    expect(result.success).toBe(true);
  });

  it('passes with dots in filename', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: ['file.with.dots.allowed'],
    });
    expect(result.success).toBe(true);
  });

  it('fails with empty array (min 1)', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: [],
    });
    expect(result.success).toBe(false);
  });

  it('fails with 9-item array (max 8)', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: nineItems(),
    });
    expect(result.success).toBe(false);
  });

  it('fails with semicolon injection (regex)', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: ['index.html; whatever'],
    });
    expect(result.success).toBe(false);
  });

  it('fails with path traversal (regex — slash rejected)', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: ['../etc/passwd'],
    });
    expect(result.success).toBe(false);
  });

  it('fails with space in filename (regex)', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: ['file with space'],
    });
    expect(result.success).toBe(false);
  });

  it('fails with empty string item (regex + has at least one char)', () => {
    const result = staticSitePayloadSchema.safeParse({
      ...staticBase,
      indexFiles: [''],
    });
    expect(result.success).toBe(false);
  });

  it('fails with dots-only filename (refine — `..` / `.` / `...`)', () => {
    for (const bad of ['.', '..', '...']) {
      const result = staticSitePayloadSchema.safeParse({
        ...staticBase,
        indexFiles: [bad],
      });
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// phpPayloadSchema — documentIndex
// ---------------------------------------------------------------------------

describe('phpPayloadSchema — documentIndex', () => {
  it('passes with a single valid filename', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: ['index.php'],
    });
    expect(result.success).toBe(true);
  });

  it('passes with two valid filenames', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: ['index.php', 'index.html'],
    });
    expect(result.success).toBe(true);
  });

  it('passes with dots in filename', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: ['file.with.dots.allowed'],
    });
    expect(result.success).toBe(true);
  });

  it('fails with empty array (min 1)', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: [],
    });
    expect(result.success).toBe(false);
  });

  it('fails with 9-item array (max 8)', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: nineItems(),
    });
    expect(result.success).toBe(false);
  });

  it('fails with semicolon injection (regex)', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: ['index.html; whatever'],
    });
    expect(result.success).toBe(false);
  });

  it('fails with path traversal (regex — slash rejected)', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: ['../etc/passwd'],
    });
    expect(result.success).toBe(false);
  });

  it('fails with space in filename (regex)', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: ['file with space'],
    });
    expect(result.success).toBe(false);
  });

  it('fails with empty string item', () => {
    const result = phpPayloadSchema.safeParse({
      ...phpBase,
      documentIndex: [''],
    });
    expect(result.success).toBe(false);
  });

  it('fails with dots-only filename', () => {
    for (const bad of ['.', '..', '...']) {
      const result = phpPayloadSchema.safeParse({
        ...phpBase,
        documentIndex: [bad],
      });
      expect(result.success).toBe(false);
    }
  });
});
