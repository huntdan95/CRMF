/**
 * The visitor's own address out of an X-Forwarded-For chain, by the rule
 * functions/src/lib/checkout-limit.ts `readForwardedFor` uses (the app
 * can't import from functions/; keep the two in step). Google's front end
 * appends the address it saw to whatever the client sent, and Google's own
 * proxy hops come after that, so those are skipped and the next one in is
 * the visitor's. Anything to its left is the client's say-so.
 *
 * Null when that entry isn't an address, or is a private one (the
 * emulator, or a proxy hop we don't know about): no address to go on.
 * Runs in the browser too (admin's waiver list), so it checks addresses
 * without node:net.
 */
export function visitorIp(chain: string | null | undefined): string | null {
  const entries = (chain ?? '').split(',').map((e) => e.trim());
  while (entries.length > 1 && isGoogleProxy(unmapIpv4(entries[entries.length - 1]!))) entries.pop();
  const last = entries.pop();
  if (!last || ipVersion(last) === 0) return null;
  const ip = unmapIpv4(last);
  return isPrivateAddress(ip) || isGoogleProxy(ip) ? null : ip;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** 4 or 6, or 0 when it isn't an IP address, as node:net's `isIP`. */
function ipVersion(s: string): 0 | 4 | 6 {
  if (IPV4.test(s)) return 4;
  if (!s.includes(':') || s.split('::').length > 2) return 0;
  const parts = s.split(':');
  // It may end in an IPv4 part (::ffff:203.0.113.5), which fills two groups.
  const v4 = parts[parts.length - 1]!.includes('.');
  if (v4 && !IPV4.test(parts[parts.length - 1]!)) return 0;
  const hex = v4 ? parts.slice(0, -1) : parts;
  if (!hex.every((p) => /^[0-9a-f]{0,4}$/i.test(p))) return 0;
  const groups = hex.filter(Boolean).length + (v4 ? 2 : 0);
  if (s.includes('::')) return groups < 8 ? 6 : 0;
  return groups === 8 && hex.every(Boolean) ? 6 : 0;
}

/**
 * Google Front End and load-balancer proxy ranges (35.191.0.0/16,
 * 130.211.0.0/22): the addresses Google's own proxies connect from, never a
 * visitor's.
 */
function isGoogleProxy(ip: string): boolean {
  if (ipVersion(ip) !== 4) return false;
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  return (a === 35 && b === 191) || (a === 130 && b === 211 && c <= 3);
}

/** `::ffff:203.0.113.5` (an IPv4 address written as IPv6) as `203.0.113.5`. */
function unmapIpv4(ip: string): string {
  return /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)?.[1] ?? ip;
}

/** Loopback, private and link-local ranges: never a visitor on the internet. */
function isPrivateAddress(ip: string): boolean {
  if (ipVersion(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}
