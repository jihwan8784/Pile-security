import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * 보안 헤더 (CSP 등)
 * - 이 사이트는 열쇠를 다루므로 가장 중요한 건 connect-src 'self':
 *   혹시 악성 스크립트가 끼어들어도 열쇠를 외부 서버로 보낼 수 없다.
 * - script-src의 'unsafe-inline'은 Next.js가 페이지에 넣는 인라인 스크립트 때문에 필요하다.
 *   (nonce 방식은 정적 페이지를 매 요청 동적 렌더링으로 바꿔야 해서 쓰지 않음)
 *   대신 외부 도메인 스크립트는 전부 막힌다.
 * - 개발 서버는 핫 리로드에 eval·웹소켓이 필요해서 개발 때만 풀어 준다.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
