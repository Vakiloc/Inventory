import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export function createScanThrottle({ windowMs = 1200 } = {}) {
  let lastCode = '';
  let lastAt = 0;

  return function shouldAccept(code, nowMs = Date.now()) {
    const c = String(code || '').trim();
    if (!c) return false;

    if (c === lastCode && (nowMs - lastAt) < windowMs) {
      console.log(`[Scanner] Ignored duplicate scan: ${c}`);
      return false;
    }
    lastCode = c;
    lastAt = nowMs;
    console.log(`[Scanner] Accepted scan: ${c}`);
    return true;
  };
}

export function createScanner({ el, setStatus, onScanned }) {
  if (typeof el !== 'function') throw new Error('createScanner: el must be a function');
  if (typeof setStatus !== 'function') throw new Error('createScanner: setStatus must be a function');
  if (typeof onScanned !== 'function') throw new Error('createScanner: onScanned must be a function');

  let scanReader;
  let scanStream;
  let scanVideo;
  const shouldAcceptScan = createScanThrottle({ windowMs: 1200 });
  let sessionId = 0;

  function stop() {
    console.log('[Scanner] Stopping camera');
    try {
      scanReader?.reset?.();
    } catch {
      // ignore
    }

    // Drop reader reference so we can't get more callbacks.
    scanReader = null;

    // Detach video stream first (helps ensure camera indicator turns off promptly).
    if (scanVideo) {
      try {
        scanVideo.pause?.();
      } catch {
        // ignore
      }
      try {
        scanVideo.srcObject = null;
      } catch {
        // ignore
      }
    }

    if (scanStream) {
      for (const t of scanStream.getTracks()) {
        try {
          t.stop();
        } catch {
          // ignore
        }
      }
    }

    scanStream = null;
    scanVideo = null;
  }

  async function start(target) {
    console.log('[Scanner] Starting camera');
    sessionId += 1;
    const mySession = sessionId;
    let handled = false;

    const dlg = el('scanDialog');
    const video = el('scanVideo');
    scanVideo = video;

    setStatus('Starting camera…');
    dlg.showModal();

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE
    ]);

    scanReader = new BrowserMultiFormatReader(hints);
    console.log('[Scanner] BrowserMultiFormatReader initialized');

    // Pre-open stream so we can reliably stop tracks on close.
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    video.srcObject = scanStream;
    await video.play();

    setStatus('Scanning…');

    await scanReader.decodeFromVideoDevice(undefined, video, async (result, err) => {
      // Ignore callbacks from a previous session.
      if (mySession !== sessionId) return;
      if (handled) return;

      if (result) {
        const text = result.getText?.() || String(result);
        const code = text.trim();
        if (!code) return;

        if (!shouldAcceptScan(code)) return;

        handled = true;

        stop();
        el('scanDialog').close();
        await onScanned(code, target);
        return;
      }

      // Ignore decode errors while scanning.
      if (err) return;
    });
  }

  return {
    startWebcamScan: start,
    stopWebcamScan: stop
  };
}
