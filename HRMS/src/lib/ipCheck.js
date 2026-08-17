function ipToInt(ip) {
  const parts = ip.trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return parts.reduce((acc, p) => acc * 256 + p, 0);
}

function isIpInCidr(ip, cidr) {
  const [range, prefixStr] = cidr.split('/');
  const prefix = prefixStr ? Number(prefixStr) : 32;
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) >>> 0 === (rangeInt & mask) >>> 0;
}

export function matchesIpWhitelist(ip, whitelist) {
  return whitelist.some((entry) => entry.active && isIpInCidr(ip, entry.ip));
}
