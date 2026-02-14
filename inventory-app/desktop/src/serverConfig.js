import os from 'node:os';

/**
 * Detects the local IPv4 address of the machine.
 * @returns {string} The detected local IP address or '127.0.0.1' if none found.
 */
export function detectLocalIp() {
  const nets = os.networkInterfaces();
  let localIp = '127.0.0.1';
  
  // Prefer standard LAN adapters (192.168.x.x, 10.0.x.x but exclude typical VPN ranges like 10.8.x.x if possible)
  // or just filter out specific adapter names if we had them.
  // For now, let's just loop and try to find a 192.168.x.x address first as a heuristic for "home network".

  const preferredPrefix = '192.168.';

  // First pass: look for preferred prefix
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && net.address.startsWith(preferredPrefix)) {
        return net.address;
      }
    }
  }

  // Second pass: Fallback to any non-internal IPv4
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
    if (localIp !== '127.0.0.1') break;
  }
  return localIp;
}

/**
 * Generates the sslip.io domain for a given IP address.
 * @param {string} ip The IP address.
 * @returns {string} The sslip.io domain.
 */
export function getSslipDomain(ip) {
  return `${ip.replace(/\./g, '-')}.sslip.io`;
}

/**
 * Configures the environment variables for the server process.
 * @param {object} params Configuration parameters.
 * @returns {object} The environment object for spawn.
 */
export function configureServerEnv({
    processEnv,
    isPackaged,
    serverPort,
    dataDir,
    registryPath,
    serverStateDir,
    pfxPath,
    pfxPass,
    rootCaPath,
    androidDebugSha256,
    webAuthnRpId,
    nodeExec,
    execPath,
    sslCert,
    sslKey
}) {
  return {
    ...processEnv,
    NODE_ENV: isPackaged ? 'production' : (processEnv.NODE_ENV || undefined),
    PORT: String(serverPort),
    INVENTORY_DATA_DIR: dataDir,
    INVENTORY_REGISTRY_PATH: registryPath,
    INVENTORY_SERVER_STATE_DIR: serverStateDir,
    HTTPS_PFX_PATH: pfxPath,
    HTTPS_PASSPHRASE: pfxPass || '',
    HTTPS_CERT_PATH: sslCert,
    HTTPS_KEY_PATH: sslKey,
    INVENTORY_ROOT_CA_PATH: rootCaPath,
    ANDROID_DEBUG_SHA256: androidDebugSha256,
    WEBAUTHN_RP_ID: webAuthnRpId,
    ...(nodeExec === execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {})
  };
}
