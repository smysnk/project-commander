const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
const serverPort = String(process.env.SERVER_PORT || '4000');

module.exports = {
  compiler: {
    styledComponents: true,
  },
  env: {
    NEXT_PUBLIC_SERVER_PORT: serverPort,
  },
  async rewrites() {
    return [
      ...(process.env.BUILD !== 'true' ? [{
        source: '/graphql',
        destination: `http://localhost:${serverPort}/graphql`,
      }] : []),
      ...(process.env.BUILD !== 'true' ? [{
        source: '/api/discovery/:path*',
        destination: `http://localhost:${serverPort}/api/discovery/:path*`,
      }] : []),
      ...(process.env.BUILD !== 'true' ? [{
        source: '/health',
        destination: `http://localhost:${serverPort}/health`,
      }] : []),
    ];
  },
};
