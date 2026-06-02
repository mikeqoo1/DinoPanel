import { describe, it, expect } from 'vitest';
import { pickTab } from '../index';

describe('toolbox pickTab', () => {
  it('maps the sub-paths to their tab', () => {
    expect(pickTab('/toolbox/fail2ban')).toBe('fail2ban');
    expect(pickTab('/toolbox/disk')).toBe('disk');
    expect(pickTab('/toolbox/services')).toBe('services');
  });

  it('defaults the bare /toolbox path to ntp', () => {
    expect(pickTab('/toolbox')).toBe('ntp');
    expect(pickTab('/toolbox/')).toBe('ntp');
    expect(pickTab('/toolbox/unknown')).toBe('ntp');
  });
});
