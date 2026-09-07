const geoip = require('geoip-lite');

/**
 * Section D CHECK B: no IP-geolocation dependency existed anywhere in this
 * codebase before this task. Added geoip-lite — a self-contained npm
 * package bundling a MaxMind GeoLite2-derived dataset, looked up entirely
 * in-process (no external API call, no API key, deterministic and
 * testable, no rate limit to worry about for frequent beacon pings).
 *
 * KNOWN LIMITATIONS (stated explicitly per instruction, not silently
 * skipped): the bundled dataset is a periodic snapshot bundled at install
 * time, not live — it will drift out of date for newly (re)allocated IP
 * blocks the longer this dependency goes un-updated. Accuracy is
 * genuinely reliable only at country level; region/city are best-effort
 * and frequently wrong for mobile carrier NAT, corporate VPNs, and cloud/
 * hosting-provider IP ranges (a beacon pushed from an office behind a
 * well-known ISP will resolve correctly far more often than one behind a
 * VPN or 4G/5G data connection). This is the closest feasible
 * approximation without adding a paid geolocation API — good enough to
 * catch a genuine city/country-level anomaly, not precise enough to be
 * the sole basis for an irreversible action (which is exactly why CHECK
 * B only ever holds a pending approval for HR to review, never auto-rejects).
 */
const lookupRegion = (ip) => {
  if (!ip) return null;
  try {
    const result = geoip.lookup(ip);
    if (!result) return null;
    // country is the reliable part; region (state/province code) is best-effort.
    return {
      country: result.country || null,
      region: result.region || null,
      city: result.city || null,
      label: [result.city, result.region, result.country].filter(Boolean).join(', ') || result.country || null,
    };
  } catch {
    return null;
  }
};

/**
 * Loose match: expected_region (HR-set free text, e.g. "IN" or "Karnataka"
 * or "Bangalore") matches if it case-insensitively appears in — or equals —
 * any of the detected country/region/city fields. Deliberately generous
 * (favors fewer false "mismatch" alerts over stricter matching) given the
 * dataset's own known imprecision above.
 */
const regionsMatch = (expectedRegion, detected) => {
  const expected = String(expectedRegion || '').trim().toLowerCase();
  if (!expected) return true; // no expectation set — nothing to mismatch against
  if (!detected) return false; // could not resolve at all — treat as mismatch, review it
  const haystack = [detected.country, detected.region, detected.city]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return haystack.some((v) => v === expected || v.includes(expected) || expected.includes(v));
};

module.exports = { lookupRegion, regionsMatch };
