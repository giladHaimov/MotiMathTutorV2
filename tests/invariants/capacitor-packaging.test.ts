import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPACITOR_HTTP_DEV_ENV,
  CAPACITOR_SERVER_ORIGIN_ENV,
  PRODUCTION_API_ORIGINS_ENV,
  readCapacitorHttpDev,
  readCapacitorServerOrigin,
} from '../../apps/web/src/lib/capacitor-env.js';
import {
  assertProductionNativePackageOrigin,
  parseOriginOnly,
} from '../../apps/web/src/lib/api-base-url.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Cookie-session Capacitor packaging invariants + debug/release network separation.
 */
describe('Capacitor cookie-session + cleartext/ATS separation', () => {
  it('platform and client use cookie sessions — no aparajita dependency', () => {
    const platform = readFileSync(join(root, 'apps/web/src/lib/platform.ts'), 'utf8');
    const client = readFileSync(join(root, 'apps/web/src/lib/api/client.ts'), 'utf8');
    const auth = readFileSync(join(root, 'apps/api/src/auth/auth.ts'), 'utf8');
    const plugin = readFileSync(join(root, 'apps/api/src/auth/plugin.ts'), 'utf8');
    const pkg = readFileSync(join(root, 'apps/web/package.json'), 'utf8');

    expect(platform).not.toContain('@aparajita/capacitor-secure-storage');
    expect(pkg).not.toContain('@aparajita/capacitor-secure-storage');
    expect(platform).toContain('cookie');
    expect(client).toContain("credentials: 'include'");
    expect(client).not.toContain('Authorization');
    expect(auth).toContain('cookie session');
    expect(plugin).not.toContain('set-auth-token');
  });

  it('canonical server origin env is identical for config-time and runtime', () => {
    expect(CAPACITOR_SERVER_ORIGIN_ENV).toBe('VITE_CAPACITOR_SERVER_URL');
    expect(CAPACITOR_HTTP_DEV_ENV).toBe('VITE_CAPACITOR_HTTP_DEV');
    expect(PRODUCTION_API_ORIGINS_ENV).toBe('VITE_PRODUCTION_API_ORIGINS');

    const config = readFileSync(join(root, 'apps/web/capacitor.config.ts'), 'utf8');
    const platform = readFileSync(join(root, 'apps/web/src/lib/platform.ts'), 'utf8');
    const envExample = readFileSync(join(root, '.env.example'), 'utf8');
    const scn15 = readFileSync(join(root, 'apps/web/SCN-15-HUMAN-SMOKE.md'), 'utf8');
    const pkg = readFileSync(join(root, 'apps/web/package.json'), 'utf8');

    for (const source of [config, platform, envExample, scn15]) {
      expect(source).toContain(CAPACITOR_SERVER_ORIGIN_ENV);
      // Reject bare CAPACITOR_SERVER_URL alias (canonical is VITE_CAPACITOR_SERVER_URL).
      expect(source.replaceAll('VITE_CAPACITOR_SERVER_URL', '')).not.toContain(
        'CAPACITOR_SERVER_URL',
      );
    }
    expect(pkg.replaceAll('VITE_CAPACITOR_SERVER_URL', '')).not.toContain('CAPACITOR_SERVER_URL');
    expect(config).toContain(`'${CAPACITOR_SERVER_ORIGIN_ENV}'`);
    expect(config).toContain(`'${CAPACITOR_HTTP_DEV_ENV}'`);
    expect(config).toContain(`'${PRODUCTION_API_ORIGINS_ENV}'`);
    expect(config).toContain('Must match CAPACITOR_SERVER_ORIGIN_ENV');
    expect(platform).toContain('readCapacitorServerOrigin');

    const env = {
      [CAPACITOR_SERVER_ORIGIN_ENV]: 'https://api.example.com',
      [CAPACITOR_HTTP_DEV_ENV]: undefined,
      [PRODUCTION_API_ORIGINS_ENV]: 'https://api.example.com',
    };
    const fromHelper = readCapacitorServerOrigin(env)!;
    const configParsed = parseOriginOnly(fromHelper, CAPACITOR_SERVER_ORIGIN_ENV);
    const runtimeParsed = assertProductionNativePackageOrigin(
      fromHelper,
      env[PRODUCTION_API_ORIGINS_ENV],
    );
    expect(configParsed).toBe(runtimeParsed);
    expect(readCapacitorHttpDev(env)).toBe(false);
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

  it('Android debug allows cleartext; release and main deny cleartext', () => {
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

  it('iOS Debug ATS exception exists; Release Info.plist keeps secure ATS', () => {
    const debugPlist = readFileSync(join(root, 'apps/web/ios/App/App/Info-Debug.plist'), 'utf8');
    const releasePlist = readFileSync(join(root, 'apps/web/ios/App/App/Info.plist'), 'utf8');
    const pbx = readFileSync(join(root, 'apps/web/ios/App/App.xcodeproj/project.pbxproj'), 'utf8');

    expect(debugPlist).toContain('NSAppTransportSecurity');
    expect(debugPlist).toContain('NSExceptionAllowsInsecureHTTPLoads');
    expect(debugPlist).toContain('localhost');
    expect(releasePlist).not.toContain('NSAppTransportSecurity');
    expect(pbx).toContain('INFOPLIST_FILE = App/Info-Debug.plist;');
    expect(pbx).toContain('INFOPLIST_FILE = App/Info.plist;');
  });

  it('iOS Podfile has no aparajita / secure storage dependency', () => {
    const podfile = readFileSync(join(root, 'apps/web/ios/App/Podfile'), 'utf8');
    const lock = readFileSync(join(root, 'apps/web/ios/App/Podfile.lock'), 'utf8');
    expect(podfile).not.toMatch(/aparajita|SecureStorage|secure-storage/i);
    expect(lock).not.toMatch(/aparajita|SecureStorage|secure-storage/i);
  });

  it('cap:dev and cap:release scripts exist with HTTP-dev / production gates', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['cap:dev']).toMatch(/VITE_CAPACITOR_HTTP_DEV=1/);
    expect(pkg.scripts['cap:dev'].replaceAll('VITE_CAPACITOR_HTTP_DEV', '')).not.toContain(
      'CAPACITOR_HTTP_DEV',
    );
    expect(pkg.scripts['cap:release']).toMatch(/CAPACITOR_PACKAGE_MODE=production/);
    expect(pkg.scripts['cap:run:ios:dev']).toMatch(/--configuration Debug/);
    expect(existsSync(join(root, 'apps/web/SCN-15-HUMAN-SMOKE.md'))).toBe(true);
  });
});
