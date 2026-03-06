const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeCheckoutDestinationState,
} = require('./hostActionUtils.cjs');

test('computeCheckoutDestinationState auto-derives destination for empty destination value', () => {
  const next = computeCheckoutDestinationState({
    inputValue: 'git@github.com:smysnk/sikuli-framework.git',
    existingDestination: '',
    previousAutoDestination: '',
    deriveDestinationFolder: (value) => value.includes('sikuli-framework') ? 'sikuli-framework' : '',
  });

  assert.equal(next.nextInputValue, 'git@github.com:smysnk/sikuli-framework.git');
  assert.equal(next.derivedDestination, 'sikuli-framework');
  assert.equal(next.nextDestination, 'sikuli-framework');
});

test('computeCheckoutDestinationState preserves manual destination override', () => {
  const next = computeCheckoutDestinationState({
    inputValue: 'git@github.com:smysnk/sikuli-framework.git',
    existingDestination: 'my-custom-folder',
    previousAutoDestination: 'sikuli-framework',
    deriveDestinationFolder: () => 'sikuli-framework',
  });

  assert.equal(next.derivedDestination, 'sikuli-framework');
  assert.equal(next.nextDestination, 'my-custom-folder');
});

test('computeCheckoutDestinationState updates destination when existing destination still equals previous auto', () => {
  const next = computeCheckoutDestinationState({
    inputValue: 'git@github.com:smysnk/SikuliGO.git',
    existingDestination: 'sikuli-framework',
    previousAutoDestination: 'sikuli-framework',
    deriveDestinationFolder: () => 'SikuliGO',
  });

  assert.equal(next.derivedDestination, 'SikuliGO');
  assert.equal(next.nextDestination, 'SikuliGO');
});
