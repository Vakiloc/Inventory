import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

export async function registerDevice(serverUrl, token = null, username = 'Owner', onStatus = () => {}) {
  console.log('[WebAuthn] registerDevice started');
  // 1. Get options
  onStatus('register_options', 'Requesting registration options...');
  // If we have a pairing token, send it to authorize registration
  if (token) console.log('[WebAuthn] Using pairing token');
  
  const optsRes = await fetch(`${serverUrl}/auth/webauthn/registration/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, user: { username } })
  });
  
  if (!optsRes.ok) {
    console.error('[WebAuthn] Failed to fetch registration options', optsRes.status);
    throw new Error('Failed to fetch registration options');
  }
  
  const options = await optsRes.json();
  console.log('[WebAuthn] Got registration options', options);
  
  // 2. Passkey creation
  onStatus('authenticator_prompt', 'Please touch your security key or authenticator...');
  let attResp;
  try {
    attResp = await startRegistration(options);
    console.log('[WebAuthn] startRegistration success');
  } catch (error) {
    console.error('[WebAuthn] startRegistration error', error);
    // Some browsers throw if cancelled
    if (error.name === 'InvalidStateError') {
       throw new Error('Authenticator was probably already registered by this user');
    }
    throw error;
  }
  
  // 3. Verify
  onStatus('verifying', 'Verifying registration with server...');
  console.log('[WebAuthn] Verifying registration...');
  const verifyRes = await fetch(`${serverUrl}/auth/webauthn/registration/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        response: attResp,
        friendlyName: `Desktop (${username})`
    })
  });
  
  const verificationJSON = await verifyRes.json();
  console.log('[WebAuthn] Verify response:', verificationJSON);
  
  if (verificationJSON.verified && verificationJSON.token) {
    onStatus('complete', 'Registration successful!');
    return verificationJSON.token;
  } else {
    throw new Error('Server failed to verify registration');
  }
}

export async function signIn(serverUrl) {
  console.log('[WebAuthn] signIn started');
  // 1. Get options
  const optsRes = await fetch(`${serverUrl}/auth/webauthn/authentication/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (!optsRes.ok) {
    console.error('[WebAuthn] Failed to fetch auth options', optsRes.status);
    throw new Error('Failed to fetch authentication options');
  }
  
  const options = await optsRes.json();
  console.log('[WebAuthn] Got auth options');
  
  // 2. Authenticate
  let asseResp;
  try {
    asseResp = await startAuthentication(options);
    console.log('[WebAuthn] startAuthentication success');
  } catch (error) {
    console.error('[WebAuthn] startAuthentication error', error);
    throw error;
  }
  
  // 3. Verify
  const verifyRes = await fetch(`${serverUrl}/auth/webauthn/authentication/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: asseResp })
  });
  
  const verificationJSON = await verifyRes.json();
  console.log('[WebAuthn] Verify auth response:', verificationJSON);
  
  if (verificationJSON.verified && verificationJSON.token) {
    return verificationJSON.token;
  } else {
    throw new Error('Server failed to verify authentication');
  }
}
