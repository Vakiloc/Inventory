// inventory-app/desktop/test/keystore.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import forge from 'node-forge';
import { ensureRootCa, issueServerCert, getKeystorePath } from '../src/keystore.js';
import { app } from 'electron'; 

// Mock Electron app.getPath
// We need to mock this BEFORE importing keystore usually, but ES modules make it hard.
// However, keystore.js imports 'electron' and uses app.getPath inside functions.
// We can mock it if we use vi.mock, but keystore.js is already imported in real usage?
// Let's rely on the fact that we can set up a temp dir.

// Actually, in a pure node test environment, 'electron' module might not exist or be mockable easily without a runner.
// We can write a script that runs via 'node' and minimal mocking, bypassing vitest if complex.
// Or just use the existing test setup.

// Let's try to mock electron.
import { vi } from 'vitest';

vi.mock('electron', () => {
    return {
        app: {
            getPath: (name) => {
                if (name === 'userData') return path.resolve('./test-artifacts/keystore-test');
                return './tmp';
            }
        }
    };
});

describe('Keystore PKI', () => {
    const testDir = path.resolve('./test-artifacts/keystore-test');

    beforeAll(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('should generate a Root CA', () => {
        const ca = ensureRootCa();
        expect(ca.key).toBeDefined();
        expect(ca.cert).toBeDefined();
        
        // Verify CA properties
        const subject = ca.cert.subject.attributes.find(a => a.name === 'commonName').value;
        expect(subject).toBe('Inventory App Root CA');
        
        // Check files exist
        expect(fs.existsSync(path.join(testDir, 'keystore', 'root.key'))).toBe(true);
        expect(fs.existsSync(path.join(testDir, 'keystore', 'root.crt'))).toBe(true);
    });

    it('should issue a Server Certificate for an IP', () => {
        const ip = '192.168.1.50';
        const pfxBuffer = issueServerCert(ip);
        expect(pfxBuffer).toBeInstanceOf(Buffer);
        expect(pfxBuffer.length).toBeGreaterThan(0);

        // Verify content by reading back (parse PFX)
        const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, ''); // no password
        
        // Should have Cert and Key
        const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const certBag = bags[forge.pki.oids.certBag][0];
        const cert = certBag.cert;

        // Verify Subject
        const commonName = cert.subject.attributes.find(a => a.name === 'commonName').value;
        expect(commonName).toBe(`Inventory Server (${ip})`);

        // Verify Issuer (should be Root CA)
        const issuerName = cert.issuer.attributes.find(a => a.name === 'commonName').value;
        expect(issuerName).toBe('Inventory App Root CA');

        // Verify SANs
        const altNames = cert.getExtension('subjectAltName').altNames;
        expect(altNames).toBeDefined();
        const ips = altNames.filter(a => a.type === 7).map(a => a.ip);
        const dns = altNames.filter(a => a.type === 2).map(a => a.value);
        
        expect(ips).toContain(ip);
        expect(dns).toContain('localhost');
        expect(dns).toContain('192-168-1-50.sslip.io');
    });

    it('should reuse existing Root CA', () => {
        const firstCa = ensureRootCa();
        const secondCa = ensureRootCa();
        
        // Compare Serial Numbers
        expect(firstCa.cert.serialNumber).toBe(secondCa.cert.serialNumber);
    });
});
