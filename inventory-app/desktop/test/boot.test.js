
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Setup global flag BEFORE imports
globalThis.__INVENTORY_TEST__ = true;

const mocks = vi.hoisted(() => ({
  refreshLookups: vi.fn(),
  updateLookupActionButtons: vi.fn(),
  categoryName: vi.fn(),
  locationName: vi.fn(),
  renderItems: vi.fn(),
  refreshItems: vi.fn(),
  openItemDialog: vi.fn(),
  cancelItemDialog: vi.fn(),
  startWebcamScan: vi.fn(),
  stopWebcamScan: vi.fn(),
  registerDevice: vi.fn(),
  signIn: vi.fn(),
  getServerUrl: vi.fn(),
}));

// Mock implementations defined inside the factory to avoid hoisting issues
vi.mock('../src/renderer/inventories.js', () => ({
  createInventoryFromUi: vi.fn(),
  loadInventories: vi.fn(),
  renderInventories: vi.fn(),
  switchInventory: vi.fn(),
}));

vi.mock('../src/renderer/lookups.js', () => ({
  createLookupsController: () => ({
    refreshLookups: mocks.refreshLookups,
    updateLookupActionButtons: mocks.updateLookupActionButtons,
    categoryName: mocks.categoryName,
    locationName: mocks.locationName,
  }),
}));

vi.mock('../src/renderer/itemsUi.js', () => ({
  createItemsController: () => ({
    renderItems: mocks.renderItems,
    refreshItems: mocks.refreshItems,
    openItemDialog: mocks.openItemDialog,
    cancelItemDialog: mocks.cancelItemDialog,
  }),
}));

// We'll retrieve the mocks from the module to spy/assert on them
import { loadInventories } from '../src/renderer/inventories.js';
import { createLookupsController } from '../src/renderer/lookups.js';
import { createItemsController } from '../src/renderer/itemsUi.js';

vi.mock('../src/renderer/scanner.js', () => ({
  createScanner: () => ({
    startWebcamScan: mocks.startWebcamScan,
    stopWebcamScan: mocks.stopWebcamScan,
  }),
}));

vi.mock('../src/renderer/webauthn.js', () => ({
  registerDevice: mocks.registerDevice,
  signIn: mocks.signIn,
}));

// Mock window.inventory bridge
// ... global mocks ...
global.window = {
  inventory: {
    getServerUrl: mocks.getServerUrl,
  },
  location: { protocol: 'file:' },
  addEventListener: vi.fn(),
};

global.document = {
  getElementById: vi.fn().mockReturnValue({
    value: '',
    textContent: '',
    addEventListener: vi.fn(),
    disabled: false,
    classList: { add: vi.fn(), remove: vi.fn() },
    style: { display: '' }
  }),
  querySelector: vi.fn(),
  addEventListener: vi.fn(),
  createElement: vi.fn().mockReturnValue({}),
  body: { appendChild: vi.fn() },
};

// ...
describe('App Boot Logic', () => {
  let lookupsCtrl;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Access mocks via imported modules
    loadInventories.mockResolvedValue();
    mocks.refreshLookups.mockResolvedValue();
    
     global.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
    };
    mocks.getServerUrl.mockResolvedValue({ serverUrl: 'http://local' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'test-owner-token' }),
    });
  });

  it('boots in LOCAL mode when no remote url is stored', async () => {
    global.localStorage.getItem.mockReturnValue(null); // No remote url
    
    // Import module under test dynamically to ensure mocks are applied? 
    // Static import is fine as long as mocks are hoisted.
    const { boot } = await import('../src/renderer/app.js');
    await boot();

    expect(mocks.getServerUrl).toHaveBeenCalled();
    expect(loadInventories).toHaveBeenCalled(); 
  });

  it('boots in REMOTE mode when remote url is stored', async () => {
    const remoteUrl = 'http://192.168.1.100:5000';
    global.localStorage.getItem.mockImplementation((key) => {
      if (key === 'remote_server_url') return remoteUrl;
      if (key === 'auth_token') return 'xyz';
      return null;
    });

    const { boot } = await import('../src/renderer/app.js');
    await boot();

    expect(mocks.getServerUrl).not.toHaveBeenCalled(); // Should skip local discovery
    
    // It should still load inventories? The current logic does NOT call loadInventories/loadToken in remote branch
    // Check app.js logic:
    // ... if (remoteUrl) { ... } else { ... await loadInventories(); await loadToken(); }
    expect(loadInventories).not.toHaveBeenCalled();
    
    // It should proceed to refreshLookups
    expect(mocks.refreshLookups).toHaveBeenCalled();
  });
});
