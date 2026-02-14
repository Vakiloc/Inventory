import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import { detectLocalIp, getSslipDomain, configureServerEnv } from '../src/serverConfig.js';

describe('serverConfig', () => {
  describe('detectLocalIp', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return the first non-internal IPv4 address', () => {
      const mockInterfaces = {
        'eth0': [
          { family: 'IPv6', address: 'fe80::1', internal: false },
          { family: 'IPv4', address: '192.168.1.50', internal: false }
        ],
        'lo': [
          { family: 'IPv4', address: '127.0.0.1', internal: true }
        ]
      };
      vi.spyOn(os, 'networkInterfaces').mockReturnValue(mockInterfaces);

      const ip = detectLocalIp();
      expect(ip).toBe('192.168.1.50');
    });

    it('should return 127.0.0.1 if no external IPv4 address is found', () => {
      const mockInterfaces = {
        'lo': [
          { family: 'IPv4', address: '127.0.0.1', internal: true }
        ]
      };
      vi.spyOn(os, 'networkInterfaces').mockReturnValue(mockInterfaces);

      const ip = detectLocalIp();
      expect(ip).toBe('127.0.0.1');
    });
  });

  describe('getSslipDomain', () => {
    it('should return correct sslip domain for an IP', () => {
      expect(getSslipDomain('192.168.1.10')).toBe('192-168-1-10.sslip.io');
      expect(getSslipDomain('127.0.0.1')).toBe('127-0-0-1.sslip.io');
    });
  });

  describe('configureServerEnv', () => {
    it('should configure environment variables correctly', () => {
      const input = {
        processEnv: { NODE_ENV: 'development', EXISTING_VAR: '123' },
        isPackaged: false,
        serverPort: 5000,
        dataDir: '/data/dir',
        registryPath: '/registry/path',
        serverStateDir: '/state/dir',
        pfxPath: '/path/to.pfx',
        pfxPass: 'secret',
        rootCaPath: '/path/root.ca',
        androidDebugSha256: 'sha256-hash',
        webAuthnRpId: 'test.sslip.io',
        nodeExec: '/usr/bin/node',
        execPath: '/usr/bin/electron'
      };

      const env = configureServerEnv(input);

      expect(env).toMatchObject({
        NODE_ENV: 'development',
        EXISTING_VAR: '123',
        PORT: '5000',
        INVENTORY_DATA_DIR: '/data/dir',
        INVENTORY_REGISTRY_PATH: '/registry/path',
        INVENTORY_SERVER_STATE_DIR: '/state/dir',
        HTTPS_PFX_PATH: '/path/to.pfx',
        HTTPS_PASSPHRASE: 'secret',
        INVENTORY_ROOT_CA_PATH: '/path/root.ca',
        ANDROID_DEBUG_SHA256: 'sha256-hash',
        WEBAUTHN_RP_ID: 'test.sslip.io'
      });
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });

    it('should set NODE_ENV to production if packaged', () => {
      const input = {
        processEnv: {},
        isPackaged: true,
        nodeExec: 'node',
        execPath: 'node'
      };
      const env = configureServerEnv(input);
      expect(env.NODE_ENV).toBe('production');
    });

    it('should set ELECTRON_RUN_AS_NODE if nodeExec equals execPath', () => {
       const input = {
        processEnv: {},
        isPackaged: true,
        nodeExec: '/path/to/exe',
        execPath: '/path/to/exe'
      };
      const env = configureServerEnv(input);
      expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    });
  });
});
