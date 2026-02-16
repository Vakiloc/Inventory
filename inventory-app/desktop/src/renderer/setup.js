document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const form = document.getElementById('setupForm');
    const btnAction = document.getElementById('btnAction');
    const statusArea = document.getElementById('statusArea');
    const modeOptions = document.querySelectorAll('.mode-option');
    
    // Inputs
    const inputs = {
        auto: {
            subdomains: document.getElementById('autoSubdomains'),
            token: document.getElementById('autoToken'),
            email: document.getElementById('autoEmail'),
        },
        manual: {
            hostname: document.getElementById('manHostname'),
            idpHostname: document.getElementById('manIdpHostname'),
            key: document.getElementById('manKey'),
            cert: document.getElementById('manCert'),
        }
    };

    let currentMode = 'auto';

    // Helper: Log Status
    const log = (msg) => {
        statusArea.style.display = 'block';
        statusArea.textContent += `> ${msg}\n`;
        statusArea.scrollTop = statusArea.scrollHeight;
    };
    
    if (window.setup.onCertLog) {
        window.setup.onCertLog(log);
    }

    // Helper: Mode Switching
    const setMode = (mode) => {
        currentMode = mode;
        modeOptions.forEach(el => el.classList.toggle('active', el.dataset.mode === mode));
        
        document.getElementById('section-auto').classList.toggle('hidden', mode !== 'auto');
        document.getElementById('section-manual').classList.toggle('hidden', mode !== 'manual');
        document.getElementById('infoAuto').classList.toggle('hidden', mode !== 'auto');
        document.getElementById('infoManual').classList.toggle('hidden', mode !== 'manual');

        btnAction.textContent = mode === 'auto' ? 'Generate & Start Server' : 'Save & Start Server';
    };

    modeOptions.forEach(el => el.addEventListener('click', () => setMode(el.dataset.mode)));

    // File Browse Handlers
    const setupBrowse = (btnId, inputId, title) => {
        document.getElementById(btnId).addEventListener('click', async () => {
            const path = await window.setup.selectFile({
                title, filters: [{ name: 'Keys', extensions: ['pem', 'crt', 'key'] }]
            });
            if (path) document.getElementById(inputId).value = path;
        });
    };
    setupBrowse('browseKey', 'manKey', 'Select Private Key');
    setupBrowse('browseCert', 'manCert', 'Select Certificate Chain');

    // MAIN SUBMIT HANDLER
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (btnAction.disabled) return;
        btnAction.disabled = true;
        statusArea.textContent = ''; // Clear logs

        try {
            if (currentMode === 'auto') {
                await handleAutoSetup();
            } else {
                await handleManualSetup();
            }
        } catch (err) {
            console.error(err);
            log(`ERROR: ${err.message}`);
            alert(`Setup Failed: ${err.message}`);
            btnAction.disabled = false;
        }
    });

    async function handleAutoSetup() {
        const subsRaw = inputs.auto.subdomains.value.trim();
        const token = inputs.auto.token.value.trim();
        const email = inputs.auto.email.value.trim();

        if (!subsRaw || !token || !email) {
            throw new Error('Please fill in Subdomains, Token, and Email.');
        }

        // Parse subdomains
        const subdomains = subsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);

        if (subdomains.length === 0) {
            throw new Error('Please provide at least one subdomain.');
        }

        // Check for existing valid certificates before invoking Certbot
        log('Checking for existing certificates...');
        try {
            const existing = await window.setup.checkExistingCerts({ subdomains });
            if (existing && existing.found) {
                const expiryDate = new Date(existing.expiresAt).toLocaleDateString();
                const msg = existing.needsRenewal
                    ? `Existing certificate found but expires soon (${expiryDate}, ${existing.daysLeft} days left).\n\nReuse it anyway, or regenerate?`
                    : `Valid certificate found (expires ${expiryDate}, ${existing.daysLeft} days left).\n\nReuse existing certificate?`;

                if (confirm(msg)) {
                    log(`Reusing existing certificate (expires ${expiryDate}).`);
                    await saveAndStart({
                        hostname: existing.hostname,
                        idpHostname: existing.idpHostname,
                        httpsKey: existing.key,
                        httpsCert: existing.cert,
                        duckdnsToken: token
                    });
                    return;
                }
                log('User chose to regenerate. Proceeding with Certbot...');
            }
        } catch (e) {
            log('Could not check existing certs: ' + e.message);
        }

        log(`Starting Certificate Generation for: ${subdomains.join(', ')}...`);
        log('Check your Taskbar for a PowerShell/Admin prompt.');
        log('This may take 2-3 minutes...');
        log('');

        const result = await window.setup.generateCert({ subdomains, token, email });

        if (!result.success) {
            log('');
            log('─────────────────────────────');
            log('❌ CERTIFICATE GENERATION FAILED');
            log('─────────────────────────────');
            log(result.message || 'Unknown error');

            if (result.details) {
                log('');
                log('Details:');
                log(result.details);
            }

            const isRateLimit = (result.message || '').includes('Rate limited');
            log('');
            if (isRateLimit) {
                log('Solutions:');
                log('  • Use different DuckDNS subdomains (e.g. add -dev suffix)');
                log('  • Wait for the rate limit to expire (shown above)');
                log('  • Use the "Manual" tab to provide existing certificate files');
            } else {
                log('Common solutions:');
                log('  • Verify DuckDNS token at https://www.duckdns.org');
                log('  • Check PowerShell window for Certbot errors');
                log('  • Wait 5 minutes if domain was just created (DNS propagation)');
            }
            log('─────────────────────────────');

            throw new Error('Certificate generation failed. See details above.');
        }

        log('✓ Certificate Generated Successfully!');
        log('');
        
        // Auto-proceed to Save & Start
        await saveAndStart({
            hostname: result.result.hostname,
            idpHostname: result.result.idpHostname,
            httpsKey: result.result.key,
            httpsCert: result.result.cert,
            duckdnsToken: token
        });
    }

    async function handleManualSetup() {
        const config = {
            hostname: inputs.manual.hostname.value.trim(),
            idpHostname: inputs.manual.idpHostname.value.trim(),
            httpsKey: inputs.manual.key.value.trim(),
            httpsCert: inputs.manual.cert.value.trim()
        };

        if (!config.hostname || !config.httpsKey || !config.httpsCert) {
            throw new Error('Please provide Hostname, Key Path, and Cert Path.');
        }

        await saveAndStart(config);
    }

    async function saveAndStart(config) {
        log('Validating configuration and starting server...');

        const result = await window.setup.validateAndSave(config);

        if (result.success) {
            log('✓ Server Started Successfully!');
            log('Redirecting to application...');
            btnAction.textContent = 'Success!';

            setTimeout(() => {
                log('Done.');
            }, 1000);
        } else {
            log('');
            log('─────────────────────────────');
            log('❌ VALIDATION FAILED');
            log('─────────────────────────────');
            log(result.message);
            log('─────────────────────────────');

            throw new Error('Validation failed. See details above.');
        }
    }

    // Self-Signed Fallback
    document.getElementById('btnSelfSigned').addEventListener('click', async () => {
        if (!confirm('Passkeys will NOT work on other devices with a self-signed certificate.\n\nContinue anyway?')) return;
        
        btnAction.disabled = true;
        try {
            await saveAndStart({ hostname: 'localhost', useSelfSigned: true });
        } catch (err) {
            alert(err.message);
            btnAction.disabled = false;
        }
    });

    // Load defaults (if any)
    try {
        const defaults = await window.setup.getConfigDefaults();
        if (defaults) {
            if (defaults.hostname) inputs.manual.hostname.value = defaults.hostname;
            if (defaults.key) inputs.manual.key.value = defaults.key;
            if (defaults.cert) inputs.manual.cert.value = defaults.cert;
        }
    } catch(e) { /* ignore */ }
});
