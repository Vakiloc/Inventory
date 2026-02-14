import {
  generateRegistrationOptions as generateRegOpts,
  verifyRegistrationResponse as verifyRegResp,
  generateAuthenticationOptions as generateAuthOpts,
  verifyAuthenticationResponse as verifyAuthResp,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import * as webauthnDb from './db.js';

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
   // Note: response.id is the credential ID (base64url)
   // response.response.clientDataJSON etc.

   // Retrieve the challenge from DB. 
   // We need to know which user this is for? Or we search by challenge?
   // Client usually sends the 'id' (credential ID) but verification needs the challenge.
   // SimpleWebAuthn examples typically lookup challenge by user. 
   // Here we'll search DB for the challenge matching the one in clientDataJSON? 
   // No, we must find the challenge stored in session/DB.
   // Simplified: we'll look up the challenge by matching the one in the response to our DB (if we store it keyed by challenge)
   // OR we assume single-user MVP and get the latest challenge for the user.
   // Let's assume we look up via the response.id if we stored it? No, response.id is new.
   
   const challengeRecord = webauthnDb.getChallengeByType('registration', 1); 
   if (!challengeRecord) throw new Error('No registration challenge found');

   const verification = await verifyRegResp({
      response,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: expectedOrigin || DEFAULT_ORIGIN,
      expectedRPID: expectedRPID,
      requireUserVerification: true,
   });

   const { verified, registrationInfo } = verification;


   
   if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;
      
      webauthnDb.markChallengeUsed(challengeRecord.tx_id);
      
      webauthnDb.saveCredential({
        credentialId: credential.id,
        userId: challengeRecord.user_id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        signCount: credential.counter,
        aaguid: credential.aaguid,
        transports: JSON.stringify(response.response.transports || []), // Optional
        friendlyName: friendlyName || 'Passkey',
      });
      
      return { verified: true, userId: challengeRecord.user_id };
   }
   
   return { verified: false };
}

// Authentication
export async function generateAuthenticationOptions({ userId } = {}) {
  // If userId provided, allow credentials for that user
  let allowCredentials;
  if (userId) {
    const creds = webauthnDb.getCredentialsByUser(userId);
    allowCredentials = creds.map(cred => ({
      id: cred.credential_id,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    }));
  }

  const options = await generateAuthOpts({
    rpID: RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  webauthnDb.saveChallenge({
    challenge: options.challenge,
    type: 'authentication',
    userId: userId || null, // Can be null for discoverable credentials
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
    expectedOrigin: expectedOrigin || ORIGIN,
    expectedRPID: RP_ID,
    authenticator: {
      credentialID: credential.credential_id,
      credentialPublicKey: Buffer.from(credential.public_key, 'base64'), // DB stored as base64
      counter: credential.sign_count,
      transports: credential.transports ? JSON.parse(credential.transports) : undefined,
    },
    requireUserVerification: true,
  });

  if (verification.verified) {
    webauthnDb.markChallengeUsed(challengeRecord.tx_id);
    webauthnDb.updateCredentialCounter(credentialId, verification.authenticationInfo.newCounter);
    
    // Return user info for login session
    return { verified: true, userId: credential.user_id };
  }

  return { verified: false };
}
