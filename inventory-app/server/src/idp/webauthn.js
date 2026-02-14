import {
  generateRegistrationOptions as generateRegOpts,
  verifyRegistrationResponse as verifyRegResp,
  generateAuthenticationOptions as generateAuthOpts,
  verifyAuthenticationResponse as verifyAuthResp,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import * as webauthnDb from './webauthnDb.js';

const DEFAULT_RP_NAME = 'InvenTory';
const DEFAULT_RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const DEFAULT_ORIGIN = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5174',
  ...(process.env.WEBAUTHN_RP_ID ? [`https://${process.env.WEBAUTHN_RP_ID}`] : [])
];

// Registration
export async function generateRegistrationOptions({ user, rpID = DEFAULT_RP_ID, rpName = DEFAULT_RP_NAME }) {
  // Get existing credentials to prevent re-registration
  const userCredentials = webauthnDb.getCredentialsByUser(user.user_id);

  const options = await generateRegOpts({
    rpName,
    rpID,
    userID: isoUint8Array.fromUTF8String(String(user.user_id)),
    userName: user.username || 'user',
    displayName: user.username || 'User',
    attestationType: 'none', // Privacy preserving
    excludeCredentials: userCredentials.map(cred => ({
      id: cred.credential_id,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });

  // Persist challenge
  webauthnDb.saveChallenge({
    challenge: options.challenge,
    type: 'registration',
    userId: user.user_id,
    expiresAt: Date.now() + 60000, // 1 min
  });

  return options;
}

// Registration
export async function verifyRegistrationResponse({ response, expectedOrigin, expectedRPID = DEFAULT_RP_ID, friendlyName }) {
   const challengeRecord = webauthnDb.getChallengeByType('registration', 1);
   if (!challengeRecord) throw new Error('No registration challenge found');

   const verification = await verifyRegResp({
      response,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: expectedOrigin || DEFAULT_ORIGIN,
      expectedRPID: expectedRPID,
      requireUserVerification: true,
   });

   if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;

      webauthnDb.markChallengeUsed(challengeRecord.tx_id);

      webauthnDb.saveCredential({
        credentialId: credential.id,
        userId: challengeRecord.user_id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        signCount: credential.counter,
        aaguid: credential.aaguid,
        transports: JSON.stringify(response.response.transports || []),
        friendlyName: friendlyName || 'Passkey',
      });

      return { verified: true, userId: challengeRecord.user_id };
   }

   return { verified: false };
}

// Authentication
export async function generateAuthenticationOptions({ userId } = {}) {
  let allowCredentials;
  if (userId) {
    const creds = webauthnDb.getCredentialsByUser(userId);
    allowCredentials = creds.map(cred => ({
      id: cred.credential_id,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    }));
  }

  const options = await generateAuthOpts({
    rpID: DEFAULT_RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  webauthnDb.saveChallenge({
    challenge: options.challenge,
    type: 'authentication',
    userId: userId || null,
    expiresAt: Date.now() + 60000,
  });

  return options;
}

export async function verifyAuthenticationResponse({ response, expectedOrigin }) {
  const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'));
  const challenge = clientData.challenge;

  const challengeRecord = webauthnDb.getChallenge(challenge);
  if (!challengeRecord || challengeRecord.type !== 'authentication') {
    throw new Error('Invalid or expired authentication challenge');
  }

  const credentialId = response.id;
  const credential = webauthnDb.getCredentialById(credentialId);

  if (!credential) {
    throw new Error('Credential not found');
  }

  const verification = await verifyAuthResp({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin: expectedOrigin || DEFAULT_ORIGIN,
    expectedRPID: DEFAULT_RP_ID,
    authenticator: {
      credentialID: credential.credential_id,
      credentialPublicKey: Buffer.from(credential.public_key, 'base64'),
      counter: credential.sign_count,
      transports: credential.transports ? JSON.parse(credential.transports) : undefined,
    },
    requireUserVerification: true,
  });

  if (verification.verified) {
    webauthnDb.markChallengeUsed(challengeRecord.tx_id);
    webauthnDb.updateCredentialCounter(credentialId, verification.authenticationInfo.newCounter);

    return { verified: true, userId: credential.user_id };
  }

  return { verified: false };
}
