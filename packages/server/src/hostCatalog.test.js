const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateRuntimeHostName,
  canMatchRuntimeHostByIp,
} = require('./hostCatalog');

test('allocateRuntimeHostName preserves the requested hostname when it is unclaimed', () => {
  const name = allocateRuntimeHostName({
    requestedName: 'blackbox',
    ip: '192.168.1.250',
    port: 45268,
    reservedNames: new Map(),
  });

  assert.equal(name, 'blackbox');
});

test('allocateRuntimeHostName allows a host to keep its own claimed hostname', () => {
  const reservedNames = new Map([['blackbox', 7]]);
  const name = allocateRuntimeHostName({
    requestedName: 'blackbox',
    ip: '192.168.1.250',
    port: 45268,
    existingId: 7,
    reservedNames,
  });

  assert.equal(name, 'blackbox');
});

test('allocateRuntimeHostName falls back to an address-qualified name on collision', () => {
  const reservedNames = new Map([['joshuas-macbook-pro.local', 3]]);
  const name = allocateRuntimeHostName({
    requestedName: 'Joshuas-MacBook-Pro.local',
    ip: '127.0.0.1',
    port: 0,
    existingId: 6,
    reservedNames,
  });

  assert.equal(name, 'Joshuas-MacBook-Pro.local (127.0.0.1)');
});

test('allocateRuntimeHostName increments when address-qualified candidates are also taken', () => {
  const reservedNames = new Map([
    ['joshuas-macbook-pro.local', 3],
    ['joshuas-macbook-pro.local (127.0.0.1)', 4],
    ['joshuas-macbook-pro.local [127.0.0.1]', 5],
  ]);
  const name = allocateRuntimeHostName({
    requestedName: 'Joshuas-MacBook-Pro.local',
    ip: '127.0.0.1',
    port: 0,
    existingId: 6,
    reservedNames,
  });

  assert.equal(name, 'Joshuas-MacBook-Pro.local [127.0.0.1] #2');
});

test('canMatchRuntimeHostByIp rejects shared SNAT IPs for identified slave agents', () => {
  const incomingIpCounts = new Map([['10.42.0.1', 2]]);

  assert.equal(canMatchRuntimeHostByIp({
    slaveId: 'cc4eed4e-ae47-438e-b118-069b57e815b1',
    ip: '10.42.0.1',
  }, incomingIpCounts), false);
});

test('canMatchRuntimeHostByIp allows unique IP fallback for identified slave agents', () => {
  const incomingIpCounts = new Map([['192.168.1.250', 1]]);

  assert.equal(canMatchRuntimeHostByIp({
    slaveId: 'cc4eed4e-ae47-438e-b118-069b57e815b1',
    ip: '192.168.1.250',
  }, incomingIpCounts), true);
});
