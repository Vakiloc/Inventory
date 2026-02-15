// Re-export shim: webauthn operations have moved to idp/webauthn.js
export {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '../idp/webauthn.js';
