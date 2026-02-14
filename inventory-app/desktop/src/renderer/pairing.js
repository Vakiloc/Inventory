import QRCode from 'qrcode';
import { t } from './i18n/index.js';

let expiryTimer = null;
let statusPollTimer = null;

function clearExpiryTimer() {
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
}

function clearStatusPollTimer() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

function formatExpiry(expiresAtMs) {
  if (!expiresAtMs) return '';
  const msLeft = Math.max(0, Number(expiresAtMs) - Date.now());
  const sec = Math.ceil(msLeft / 1000);
  const at = new Date(Number(expiresAtMs)).toLocaleTimeString();
  return sec <= 0
    ? t('dialog.pair.expiredAt', { at })
    : t('dialog.pair.inSecondsAt', { sec, at });
}

export async function showPairing({ el, serverUrl, windowInventory }) {
  // For LAN pairing, encode a LAN-reachable URL (not 127.0.0.1).
  let url = serverUrl;
  let ips = [];
  try {
    const lan = await windowInventory?.getLanBaseUrl?.();
    if (lan?.baseUrl) url = lan.baseUrl;
    if (lan?.ips) ips = lan.ips;
  } catch {
    // ignore and fallback to serverUrl
  }

  const res = await fetch(`${serverUrl}/api/admin/pair-code`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.code) {
    throw new Error(body?.error || t('errors.pairCodeGenerationFailed'));
  }

  const expiresAtMs = body.expires_at_ms;
  const code = body.code;
  
  // Helper to render QR
  const renderQr = async (targetUrl, targetIps) => {
      if (!targetUrl) return;
      
      const payloadObj = { 
        baseUrl: targetUrl, 
        code, 
        expires_at_ms: expiresAtMs, 
        ips: targetIps
      };
      
      const payload = JSON.stringify(payloadObj);
      el('pairUrl').textContent = targetUrl;
      const payloadEl = el('pairPayload');
      if (payloadEl) payloadEl.value = payload;
      
      try {
        // Generate higher resolution for the big view implicitly by using current settings, 
        // but display it large.
        const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 600 });
        const qrEl = el('pairQr');
        if (qrEl) {
          qrEl.src = dataUrl;
          
          // Click to Zoom Logic
          qrEl.onclick = () => {
             const zoomDialog = document.getElementById('qrZoomDialog');
             const zoomImg = document.getElementById('pairQrZoom');
             if (zoomDialog && zoomImg) {
                zoomImg.src = dataUrl;
                zoomDialog.showModal();
             }
          };
        }
      } catch (e) {
        console.error('QR Render error', e);
      }
  };

  // Zoom Dialog Close Handler
  const closeZoom = document.getElementById('closeQrZoom');
  if (closeZoom) {
     closeZoom.onclick = () => {
        const d = document.getElementById('qrZoomDialog');
        if (d) d.close();
     };
  }
  
  // Close Zoom on backdrop click
  const zoomDialog = document.getElementById('qrZoomDialog');
  if (zoomDialog) {
     zoomDialog.addEventListener('click', (e) => {
        if (e.target === zoomDialog) zoomDialog.close();
     });
  }

  // Initial Render
  await renderQr(url, ips);

  // Listen for Tunnel Changes (if supported)
  let cleanupListener = null;
  if (windowInventory?.onTunnelStatusChanged) {
      cleanupListener = windowInventory.onTunnelStatusChanged(async (status) => {
          if (!dialog?.open) return;
          console.log('Pairing: Tunnel status changed', status);
          if (status.active && status.url) {
              await renderQr(status.url, []);
          } else {
              // Fallback to LAN discovery
              let newUrl = serverUrl;
              let newIps = [];
              try {
                const lan = await windowInventory.getLanBaseUrl();
                if (lan?.baseUrl) newUrl = lan.baseUrl;
                if (lan?.ips) newIps = lan.ips;
              } catch {}
              await renderQr(newUrl, newIps);
          }
      });
  }

  el('pairExpires').textContent = formatExpiry(expiresAtMs);

  const dialog = el('pairDialog');
  clearExpiryTimer();
  clearStatusPollTimer();
  expiryTimer = setInterval(() => {
    const expiresEl = el('pairExpires');
    if (expiresEl) expiresEl.textContent = formatExpiry(expiresAtMs);
  }, 500);

  // Poll server to know when the QR has been consumed by a successful pairing.
  // This enables desktop feedback and discards the QR once redeemed.
  const statusUrl = `${serverUrl}/api/admin/pair-code/${encodeURIComponent(code)}/status`;
  statusPollTimer = setInterval(async () => {
    if (!dialog?.open) return;
    try {
      const r = await fetch(statusUrl);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return;
      if (!b?.status) return;

      const detail = b.status_detail || 'active';
      const expiresEl = el('pairExpires');

      if (detail === 'scanned') {
          if (expiresEl) {
             expiresEl.textContent = t('dialog.pair.scanned');
             expiresEl.className = 'status status-action';
          }
      } else if (detail === 'cancelled') {
          if (expiresEl) {
             expiresEl.textContent = t('dialog.pair.cancelled');
             expiresEl.className = 'status status-error';
          }
          // Resume countdown after a short message?
          // For now, let user see cancelled state.
      } else if (b.status === 'consumed') {
        clearExpiryTimer();
        clearStatusPollTimer();

        if (expiresEl) {
            expiresEl.textContent = t('dialog.pair.paired');
            expiresEl.className = 'status status-success';
        }

        const qrEl = el('pairQr');
        if (qrEl) qrEl.style.display = 'none';
      } else if (b.status === 'expired') {
        clearStatusPollTimer();
      } else {
         // Reset style for active
         if (expiresEl && detail === 'created') expiresEl.className = 'status'; 
      }
    } catch {
      // ignore transient failures
    }
  }, 500);

  // Ensure we stop timers when dialog closes.
  // Use once:true to bind cleanup specifically to this modal session.
  dialog.addEventListener('close', () => {
      clearExpiryTimer();
      clearStatusPollTimer();
      if (cleanupListener) cleanupListener();
      
      const qrEl = el('pairQr');
      if (qrEl) qrEl.style.display = '';
  }, { once: true });

  dialog.showModal();
}
