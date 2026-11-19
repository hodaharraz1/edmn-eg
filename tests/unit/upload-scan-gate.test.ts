import { afterEach, describe, expect, it } from 'vitest';
import { initialScanStatus, publicScanRequired, scanRequired, servable, setScannerForTests } from '@/server/storage/scanning';

/**
 * Policy SEC-059 / phase-2 item 4: production must never serve an upload that has no CLEAN scanner verdict, public or
 * private, and MALWARE_SCAN_REQUIRED=false cannot weaken that. Pins the whole decision matrix so it cannot regress.
 */
const saved = { env: process.env.EDMN_ENVIRONMENT, req: process.env.MALWARE_SCAN_REQUIRED };
afterEach(() => {
  process.env.EDMN_ENVIRONMENT = saved.env;
  process.env.MALWARE_SCAN_REQUIRED = saved.req;
  setScannerForTests(undefined);
});

describe('upload malware-scan gate', () => {
  it('production: only CLEAN is served, for every visibility, even with MALWARE_SCAN_REQUIRED=false', () => {
    process.env.EDMN_ENVIRONMENT = 'production';
    process.env.MALWARE_SCAN_REQUIRED = 'false';
    expect(scanRequired()).toBe(true);
    expect(publicScanRequired()).toBe(true);
    for (const visibility of ['PUBLIC', 'PRIVATE']) {
      expect(servable({ visibility, scanStatus: 'CLEAN' })).toBe(true);
      for (const scanStatus of ['UNSCANNED', 'QUARANTINED', 'INFECTED', 'ERROR']) expect(servable({ visibility, scanStatus }), `${visibility}/${scanStatus}`).toBe(false);
    }
  });

  it('production without a scanner: new uploads start QUARANTINED (never served), not UNSCANNED', () => {
    process.env.EDMN_ENVIRONMENT = 'production';
    setScannerForTests(null);
    expect(initialScanStatus('PUBLIC')).toBe('QUARANTINED');
    expect(initialScanStatus('PRIVATE')).toBe('QUARANTINED');
  });

  it('staging: private files follow MALWARE_SCAN_REQUIRED; public re-encoded images stay visible', () => {
    process.env.EDMN_ENVIRONMENT = 'staging';
    process.env.MALWARE_SCAN_REQUIRED = 'true';
    expect(servable({ visibility: 'PRIVATE', scanStatus: 'UNSCANNED' })).toBe(false);
    expect(servable({ visibility: 'PUBLIC', scanStatus: 'UNSCANNED' })).toBe(true);
    process.env.MALWARE_SCAN_REQUIRED = 'false';
    expect(servable({ visibility: 'PRIVATE', scanStatus: 'UNSCANNED' })).toBe(true);
    expect(servable({ visibility: 'PRIVATE', scanStatus: 'INFECTED' })).toBe(false);
  });
});
