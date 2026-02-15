/**
 * Checks if an IP address belongs to a local network.
 * Supports IPv4 and IPv6 (including IPv4-mapped IPv6).
 */
function isLocalIp(remoteAddress) {
  if (!remoteAddress) return false;

  // IPv6 Mapped IPv4 (e.g., ::ffff:192.168.1.1)
  if (remoteAddress.startsWith('::ffff:')) {
    remoteAddress = remoteAddress.substring(7);
  }

  // IPv4 Local Ranges
  // 127.0.0.0/8 (Loopback)
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(remoteAddress)) return true;
  // 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(remoteAddress)) return true;
  // 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(remoteAddress)) return true;
  // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(remoteAddress)) return true;

  // IPv6 Local Ranges
  // ::1 (Loopback)
  if (remoteAddress === '::1') return true;
  // fe80::/10 (Link-Local)
  if (/^fe80:/i.test(remoteAddress)) return true;
  // fc00::/7 (Unique Local Address)
  if (/^f[cd][0-9a-f]{2}:/i.test(remoteAddress)) return true;

  return false;
}

export function requireLocalNetwork(req, res, next) {
  const remoteAddress = req.socket.remoteAddress;

  if (isLocalIp(remoteAddress)) {
    next();
  } else {
    console.warn(`[Security] Blocked non-local access to ${req.originalUrl} from ${remoteAddress}`);
    res.status(403).json({
      error: 'Access Denied',
      message: 'This action is restricted to the local network.'
    });
  }
}
