import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import forge from 'node-forge';

const KEYSTORE_DIR_NAME = 'keystore';
const ROOT_KEY_NAME = 'root.key';
const ROOT_CERT_NAME = 'root.crt';

export function getKeystorePath() {
  return path.join(app.getPath('userData'), KEYSTORE_DIR_NAME);
}

export function getRootCertPath() {
  return path.join(getKeystorePath(), ROOT_CERT_NAME);
}

/**
 * Ensures the Root CA exists. If not, generates one.
 * Returns the Root CA Private Key and Certificate (Forge objects).
 */
export function ensureRootCa() {
  const dir = getKeystorePath();
  const rootKeyPath = path.join(dir, ROOT_KEY_NAME);
  const rootCertPath = path.join(dir, ROOT_CERT_NAME);

  if (fs.existsSync(rootKeyPath) && fs.existsSync(rootCertPath)) {
    try {
      const keyPem = fs.readFileSync(rootKeyPath, 'utf8');
      const certPem = fs.readFileSync(rootCertPath, 'utf8');
      return {
        key: forge.pki.privateKeyFromPem(keyPem),
        cert: forge.pki.certificateFromPem(certPem)
      };
    } catch (err) {
      console.error('Error reading existing Root CA, regenerating...', err);
      // Fall through to regeneration
    }
  }

  // --- Generate new Root CA ---
  
  // 1. Generate Key Pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // 2. Create Certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01'; // Fixed serial for Root, or randomString
  
  // Validity: 10 years
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [{ name: 'commonName', value: 'Inventory App Root CA' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // Self-signed

  // Extensions for Root CA
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: true,
      pathLenConstraint: 0 // Can only sign leaf certs, not other CAs
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true
    },
    {
        name: 'subjectKeyIdentifier'
    }
  ]);

  // 3. Sign
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // 4. Save to disk
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);

  fs.writeFileSync(rootKeyPath, keyPem);
  fs.writeFileSync(rootCertPath, certPem);

  return { key: keys.privateKey, cert: cert };
}

/**
 * Issues a server certificate signed by the Root CA.
 * @param {string} ipAddress - The IP address of the machine.
 * @returns {Buffer} PFX (PKCS#12) buffer containing Key + Cert + Root Chain.
 */
export function issueServerCert(ipAddress) {
  // 1. Get Root CA
  const rootCa = ensureRootCa();

  // 2. Generate Server Key Pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // 3. Create Server Certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  // Random serial number
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));

  // Validity: 1 year
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  // Subject
  cert.setSubject([
    { name: 'commonName', value: `Inventory Server (${ipAddress})` }
  ]);
  
  // Issuer (Root CA)
  cert.setIssuer(rootCa.cert.subject.attributes);

  // SANs
  const sslipDomain = `${ipAddress.replace(/\./g, '-')}.sslip.io`;
  
  const altNames = [
    { type: 2, value: 'localhost' },           // DNS: localhost
    { type: 7, ip: ipAddress },                // IP: <ipAddress>
    { type: 2, value: sslipDomain }            // DNS: <ip-dashes>.sslip.io
  ];

  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: 'extKeyUsage',
      serverAuth: true
    },
    {
      name: 'subjectAltName',
      altNames: altNames
    },
    {
        name: 'authorityKeyIdentifier',
        keyIdentifier: rootCa.cert.generateSubjectKeyIdentifier().getBytes()
    }
  ]);

  // 4. Sign with Root CA Private Key
  cert.sign(rootCa.key, forge.md.sha256.create());

  // 5. Package into PFX (PKCS#12)
  // We include the cert, the key, and the root cert in the chain.
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert, rootCa.cert],
    '', // No password for PFX (typical for internal server usage automations, or change as needed)
    { algorithm: '3des' } // standard compatibility
  );

  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Buffer = Buffer.from(p12Der, 'binary');

  return p12Buffer;
}
