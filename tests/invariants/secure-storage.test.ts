import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Auth tokens must use Keychain / Keystore-backed storage, not Preferences,
 * and Android backups must not export those secrets.
 */
describe('native secure token storage configuration', () => {
  it('platform module uses @aparajita/capacitor-secure-storage with device-only keychain', () => {
    const source = readFileSync(join(root, 'apps/web/src/lib/platform.ts'), 'utf8');
    expect(source).toContain('@aparajita/capacitor-secure-storage');
    expect(source).toContain('KeychainAccess.whenUnlockedThisDeviceOnly');
    expect(source).not.toContain('@capacitor/preferences');
  });

  it('AndroidManifest disables backup / data extraction of app secrets', () => {
    const manifest = readFileSync(
      join(root, 'apps/web/android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('data_extraction_rules');

    const rules = readFileSync(
      join(root, 'apps/web/android/app/src/main/res/xml/data_extraction_rules.xml'),
      'utf8',
    );
    expect(rules).toContain('cloud-backup');
    expect(rules).toContain('exclude domain="sharedpref"');
  });
});
