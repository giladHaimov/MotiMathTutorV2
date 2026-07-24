import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Cookie-session Capacitor packaging: no bearer / secure-storage token path.
 * Android cleartext is debug-only and must not leak into release.
 */
describe('Capacitor cookie-session + cleartext separation', () => {
  it('platform and client use cookie sessions — no bearer/secure-storage', () => {
    const platform = readFileSync(join(root, 'apps/web/src/lib/platform.ts'), 'utf8');
    const client = readFileSync(join(root, 'apps/web/src/lib/api/client.ts'), 'utf8');
    const auth = readFileSync(join(root, 'apps/api/src/auth/auth.ts'), 'utf8');

    expect(platform).not.toContain('@aparajita/capacitor-secure-storage');
    expect(platform).toContain('cookie');
    expect(client).toContain("credentials: 'include'");
    expect(client).not.toContain('Authorization');
    expect(client).not.toContain('set-auth-token');
    expect(auth).not.toContain('bearer(');
    expect(auth).toContain('cookie session');
  });

  it('auth plugin strips set-auth-token issuance headers', () => {
    const plugin = readFileSync(join(root, 'apps/api/src/auth/plugin.ts'), 'utf8');
    expect(plugin).toContain('set-auth-token');
    expect(plugin).toContain('Strip');
  });

  it('AndroidManifest disables backup / data extraction', () => {
    const manifest = readFileSync(
      join(root, 'apps/web/android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('data_extraction_rules');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');

    const rules = readFileSync(
      join(root, 'apps/web/android/app/src/main/res/xml/data_extraction_rules.xml'),
      'utf8',
    );
    expect(rules).toContain('cloud-backup');
    expect(rules).toContain('exclude domain="sharedpref"');
  });

  it('debug allows cleartext; release and main deny cleartext', () => {
    const debugManifest = readFileSync(
      join(root, 'apps/web/android/app/src/debug/AndroidManifest.xml'),
      'utf8',
    );
    const releaseManifest = readFileSync(
      join(root, 'apps/web/android/app/src/release/AndroidManifest.xml'),
      'utf8',
    );
    const mainNsc = readFileSync(
      join(root, 'apps/web/android/app/src/main/res/xml/network_security_config.xml'),
      'utf8',
    );
    const debugNsc = readFileSync(
      join(root, 'apps/web/android/app/src/debug/res/xml/network_security_config.xml'),
      'utf8',
    );
    const releaseNsc = readFileSync(
      join(root, 'apps/web/android/app/src/release/res/xml/network_security_config.xml'),
      'utf8',
    );

    expect(debugManifest).toContain('android:usesCleartextTraffic="true"');
    expect(releaseManifest).toContain('android:usesCleartextTraffic="false"');
    expect(mainNsc).toContain('cleartextTrafficPermitted="false"');
    expect(debugNsc).toContain('cleartextTrafficPermitted="true"');
    expect(releaseNsc).toContain('cleartextTrafficPermitted="false"');
  });

  it('cap:dev and cap:release scripts exist with HTTP-dev / production gates', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['cap:dev']).toMatch(/CAPACITOR_HTTP_DEV=1/);
    expect(pkg.scripts['cap:dev']).toMatch(/VITE_CAPACITOR_HTTP_DEV=1/);
    expect(pkg.scripts['cap:release']).toMatch(/CAPACITOR_PACKAGE_MODE=production/);
    expect(existsSync(join(root, 'apps/web/SCN-15-HUMAN-SMOKE.md'))).toBe(true);
  });
});
