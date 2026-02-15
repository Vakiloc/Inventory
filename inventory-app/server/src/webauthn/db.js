// Re-export shim: webauthn DB operations have moved to idp/webauthnDb.js
export {
  setStateDb,
  saveChallenge,
  getChallenge,
  getChallengeByType,
  markChallengeUsed,
  saveCredential,
  getCredentialsByUser,
  getCredentialById,
  updateCredentialCounter
} from '../idp/webauthnDb.js';
