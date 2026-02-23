import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.inventory.mobile',
  appName: 'Inventory',
  webDir: 'dist',
  server: {
    // Allow loading from LAN server with self-signed certs
    cleartext: true,
    androidScheme: 'https'
  },
  plugins: {
    CapacitorHttp: {
      enabled: false // Use fetch directly for API calls
    }
  }
};

export default config;
