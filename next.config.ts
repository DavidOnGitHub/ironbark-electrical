import type { NextConfig } from "next";

const securityHeaders = [
  // Clickjacking: never frame the console. (The full CSP below also carries
  // frame-ancestors 'none'; X-Frame-Options remains for legacy browsers.)
  { key: "X-Frame-Options", value: "DENY" },
  // Don't let browsers guess at response types (e.g. sniffing a JSON API
  // response as HTML and scripting it).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // This is a single-org tool - the URL path is not something to leak to
  // external referrers at all.
  { key: "Referrer-Policy", value: "no-referrer" },
  // Belt-and-braces capability denial; nothing here needs them.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // CSP: 'unsafe-inline' for script/style is required by Next.js hydration
  // (inline bootstrapping scripts) without nonce plumbing - accepted for this
  // tool; the meaningful hardening here is the lockdown of every other source
  // to 'self' plus frame-ancestors 'none'. Auth.js runs same-origin.
  //
  // The Google Picker (packages/m-street-kit/src/routes/connectors/[id]/DriveGrants.tsx)
  // is the one third-party surface, so the Google hosts it needs are allowed
  // narrowly: apis.google.com (the gapi/picker loader script), docs.google.com
  // (the Picker iframe and its RPC), content.googleapis.com (Picker data calls),
  // and googleusercontent.com (Drive thumbnails). Nothing else is opened up.
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://apis.google.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: https://*.googleusercontent.com https://www.gstatic.com; " +
      "font-src 'self'; " +
      "connect-src 'self' https://apis.google.com https://docs.google.com https://drive.google.com https://content.googleapis.com https://www.googleapis.com; " +
      "frame-src 'self' https://docs.google.com https://drive.google.com https://content.googleapis.com; " +
      "object-src 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'; " +
      "frame-ancestors 'none'",
  },
];

/** HSTS (CASA 4.1.1): browsers remember to use only HTTPS for this host for a
 * year, so even a typed/bookmarked http:// URL never goes out in cleartext.
 * Production only - `next dev` serves plain http://localhost. No
 * includeSubDomains: that would force HTTPS onto every *.mstreetsystem.com
 * site, which this app doesn't control. */
const hstsHeader =
  process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : [];

const nextConfig: NextConfig = {
  // Don't advertise the framework (X-Powered-By: Next.js) - CASA 6.2.1.
  // The console ships as TypeScript source (see the kit's package.json).
  transpilePackages: ["@kabosh-digital/m-street-kit"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [...securityHeaders, ...hstsHeader] }];
  },
  // Next.js aborts forwarded Server Actions when the browser's `Origin`
  // header doesn't match the `x-forwarded-host` set by Render's LB. Most
  // browsers send `Origin: <the same host>` and pass; some (in-app browsers,
  // privacy extensions, sandboxed contexts) send the opaque value `null`
  // instead, which Next treats as a mismatch and kills the action. The
  // real hosts are here for parity, and the literal `null` is allowed
  // because it is exactly the missing-origin case Next itself tolerates
  // with a warning - and session cookies are SameSite=Lax, so cross-site
  // POSTs can't carry credentials anyway. The Google button is a plain GET
  // link (see signin/page.tsx) and never needs this; the credentials form
  // is a POST server action and does.
  experimental: {
    serverActions: {
      allowedOrigins: ["null"], // add the deployed demo hostname(s) when hosted
    },
  },
};

export default nextConfig;
