const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPublicRegistrationEnabled } = require('../dist/auth/registration-policy');

test('unset variable keeps registration open (development and CI unchanged)', () => {
  assert.equal(isPublicRegistrationEnabled({}), true);
});
test('"false" closes public registration', () => {
  assert.equal(isPublicRegistrationEnabled({ ALLOW_PUBLIC_REGISTRATION: 'false' }), false);
});
test('only the exact value "true" opens it: typos fail closed', () => {
  assert.equal(isPublicRegistrationEnabled({ ALLOW_PUBLIC_REGISTRATION: 'true' }), true);
  for (const typo of ['False', 'FALSE', 'no', '0', '', ' true']) {
    assert.equal(isPublicRegistrationEnabled({ ALLOW_PUBLIC_REGISTRATION: typo }), false, `"${typo}" must close registration`);
  }
});
