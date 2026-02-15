// Re-export shim: stateDb has moved to idp/stateDb.js
export {
  getServerStateDir,
  openStateDb,
  getServerSecret,
  getOwnerToken,
  createPairingCode,
  updatePairingCodeStatus,
  validatePairingCode,
  consumePairingCode,
  getPairingCodeStatus,
  upsertDevice,
  getDevice,
  listDevices,
  setDeviceRevoked
} from './idp/stateDb.js';
