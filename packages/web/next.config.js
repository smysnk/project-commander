const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
const serverPort = String(process.env.SERVER_PORT || '4000');
const internalServerUrl = String(process.env.SERVER_URL || '').trim() || `http://localhost:${serverPort}`;
const nextPublicServerPort = String(process.env.NEXT_PUBLIC_SERVER_PORT || '').trim();
const nextPublicWsUrl = String(process.env.NEXT_PUBLIC_WS_URL || '').trim();

module.exports = {
  compiler: {
    styledComponents: true,
  },
  env: {
    ...(nextPublicServerPort ? { NEXT_PUBLIC_SERVER_PORT: nextPublicServerPort } : {}),
    ...(nextPublicWsUrl ? { NEXT_PUBLIC_WS_URL: nextPublicWsUrl } : {}),
  },
  async rewrites() {
    return [
      {
        source: '/graphql',
        destination: `${internalServerUrl}/graphql`,
      },
      {
        source: '/api/discovery/:path*',
        destination: `${internalServerUrl}/api/discovery/:path*`,
      },
      {
        source: '/health',
        destination: `${internalServerUrl}/health`,
      },
    ];
  },
};
