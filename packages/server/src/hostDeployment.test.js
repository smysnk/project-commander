const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCurrentMachineHost,
  resolveConnectionTarget,
} = require('./hostDeployment');

test('isCurrentMachineHost treats loopback and local interface addresses as local', () => {
  const networkInterfaces = {
    en0: [
      { address: '192.168.1.15' },
      { address: 'fe80::1' },
    ],
  };

  assert.equal(isCurrentMachineHost('127.0.0.1', { networkInterfaces, hostname: 'example-host' }), true);
  assert.equal(isCurrentMachineHost('192.168.1.15', { networkInterfaces, hostname: 'example-host' }), true);
  assert.equal(isCurrentMachineHost('example-host', { networkInterfaces, hostname: 'example-host' }), true);
  assert.equal(isCurrentMachineHost('192.168.1.250', { networkInterfaces, hostname: 'example-host' }), false);
});

test('resolveConnectionTarget normalizes same-machine LAN addresses to local execution', () => {
  const networkInterfaces = {
    en0: [{ address: '192.168.1.15' }],
  };
  const originalNetworkInterfaces = require('os').networkInterfaces;
  const os = require('os');
  os.networkInterfaces = () => networkInterfaces;
  try {
    const target = resolveConnectionTarget({
      hostIp: '192.168.1.15',
      metadata: {
        sshUser: 'josh',
        sshPort: 22,
      },
    });

    assert.equal(target.host, '192.168.1.15');
    assert.equal(target.isLocal, true);
    assert.equal(target.sshUser, 'josh');
  } finally {
    os.networkInterfaces = originalNetworkInterfaces;
  }
});
