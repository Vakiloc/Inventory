import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

// Path to Android Debug Keystore
const keystorePath = path.join(os.homedir(), '.android', 'debug.keystore');

console.log('[DevSetup] Checking Android Debug Keystore...');

// Check if java/keytool is available
try {
    execSync('keytool -help', { stdio: 'ignore' });
} catch (e) {
    console.warn('[DevSetup] WARNING: "keytool" command not found in PATH. Android keystore checks will be skipped. Ensure Java is installed if you need Android debugging.');
    process.exit(0); // Exit gracefully, don't break the build/start
}

try {
  if (!fs.existsSync(keystorePath)) {
    console.log('[DevSetup] Keystore not found. Creating new debug.keystore...');
    const cmd = `keytool -genkey -v -keystore "${keystorePath}" -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('[DevSetup] Created debug.keystore');
  } else {
    console.log('[DevSetup] debug.keystore exists.');
  }

  // Extract SHA-256
  console.log('[DevSetup] Extracting SHA-256 fingerprint...');
  // Note: keytool output language varies by OS locale, so parsing might be fragile if looking for "SHA256:".
  // However, usually "SHA256:" is standard or we can look for the pattern.
  // Using -list -v which provides the fingerprint.
  const listCmd = `keytool -list -v -keystore "${keystorePath}" -alias androiddebugkey -storepass android -keypass android`;
  const output = execSync(listCmd, { encoding: 'utf8' });
  
  // Regex to find SHA256 (supports localized labels if they keep the SHA256: prefix or strictly formats)
  // Usually lines look like: "SHA256: XX:XX:..."
  const match = output.match(/SHA256:\s*([0-9A-Fa-f:]+)/);
  if (match && match[1]) {
    const sha = match[1].trim();
    console.log(`[DevSetup] Found SHA-256: ${sha}`);
    
    // Set it for the current process env, so Electron/Server picks it up
    process.env.ANDROID_DEBUG_SHA256 = sha;
  } else {
    console.warn('[DevSetup] Could not parse SHA-256 from keytool output.');
  }

} catch (err) {
  console.error('[DevSetup] Error managing keystore:', err.message);
  // Don't fail the build, just warn
}
