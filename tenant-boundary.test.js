const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');

let testEnv;

const BUS_A = 'BUS_testAAAAAAAA';
const BUS_B = 'BUS_testBBBBBBBB';
const BUS_SUSPENDED = 'BUS_testSUSPENDED';
const BUS_NONEXISTENT = 'BUS_doesNotExist99';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mother-engine-rules-test',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8')
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seeded with rules disabled — this is the ONE place in this whole
  // suite where we bypass rules, deliberately, to set up the world the
  // way an admin script would (createBusiness.js, assignUserToBusiness.js
  // both use the Admin SDK, which also bypasses rules). Every actual test
  // below goes through the real rules with no bypass.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('businesses').doc(BUS_A).set({ businessId: BUS_A, displayName: 'Business A', slug: 'business-a', status: 'active' });
    await db.collection('businesses').doc(BUS_B).set({ businessId: BUS_B, displayName: 'Business B', slug: 'business-b', status: 'active' });
    await db.collection('businesses').doc(BUS_SUSPENDED).set({ businessId: BUS_SUSPENDED, displayName: 'Suspended Biz', slug: 'suspended-biz', status: 'suspended' });

    await db.collection('businesses').doc(BUS_A).collection('products').doc('prod1')
      .set({ businessId: BUS_A, name: 'Existing A Product', retailPrice: 100 });
    await db.collection('businesses').doc(BUS_B).collection('products').doc('prod1')
      .set({ businessId: BUS_B, name: 'Existing B Product', retailPrice: 150 });

    await db.collection('businesses').doc(BUS_A).collection('workers').doc('alice-uid')
      .set({ userId: 'USR_alice', email: 'alice@a.test', role: 'owner', status: 'active' });

    await db.collection('platformOperators').doc('root-uid')
      .set({ email: 'root@platform.test' });
  });
});

function asBusinessA(uid) { return testEnv.authenticatedContext(uid || 'alice-uid', { businessId: BUS_A, role: 'owner', userId: 'USR_alice' }); }
function asBusinessAWorker(uid) { return testEnv.authenticatedContext(uid || 'carol-uid', { businessId: BUS_A, role: 'worker', userId: 'USR_carol' }); }
function asBusinessB(uid) { return testEnv.authenticatedContext(uid || 'bob-uid', { businessId: BUS_B, role: 'owner', userId: 'USR_bob' }); }
function asPlatformOperator(uid) { return testEnv.authenticatedContext(uid || 'root-uid', { platformOperator: true }); }
function asAnonymous() { return testEnv.unauthenticatedContext(); }

describe('Own-tenant access — Business A → A data, Business B → B data', () => {
  test('Business A member CAN read Business A products ✅', async () => {
    await assertSucceeds(
      asBusinessA().firestore().collection('businesses').doc(BUS_A).collection('products').doc('prod1').get()
    );
  });

  test('Business A member CAN write Business A products ✅', async () => {
    await assertSucceeds(
      asBusinessA().firestore().collection('businesses').doc(BUS_A).collection('products').doc('newProd')
        .set({ businessId: BUS_A, name: 'New A Product', retailPrice: 200 })
    );
  });

  test('Business B member CAN read Business B products ✅', async () => {
    await assertSucceeds(
      asBusinessB().firestore().collection('businesses').doc(BUS_B).collection('products').doc('prod1').get()
    );
  });

  test('Business B member CAN write Business B products ✅', async () => {
    await assertSucceeds(
      asBusinessB().firestore().collection('businesses').doc(BUS_B).collection('products').doc('newProd')
        .set({ businessId: BUS_B, name: 'New B Product', retailPrice: 300 })
    );
  });
});

describe('Cross-tenant READ — must be denied both directions', () => {
  test('Business A member CANNOT read Business B products ❌', async () => {
    await assertFails(
      asBusinessA().firestore().collection('businesses').doc(BUS_B).collection('products').doc('prod1').get()
    );
  });

  test('Business B member CANNOT read Business A products ❌', async () => {
    await assertFails(
      asBusinessB().firestore().collection('businesses').doc(BUS_A).collection('products').doc('prod1').get()
    );
  });
});

describe('Cross-tenant WRITE — must be denied both directions', () => {
  test('Business A member CANNOT write into Business B products ❌', async () => {
    await assertFails(
      asBusinessA().firestore().collection('businesses').doc(BUS_B).collection('products').doc('hack')
        .set({ businessId: BUS_B, name: 'Hacked', retailPrice: 1 })
    );
  });

  test('Business B member CANNOT write into Business A products ❌', async () => {
    await assertFails(
      asBusinessB().firestore().collection('businesses').doc(BUS_A).collection('products').doc('hack')
        .set({ businessId: BUS_A, name: 'Hacked', retailPrice: 1 })
    );
  });

  test('Business A member CANNOT overwrite an existing Business B product ❌', async () => {
    await assertFails(
      asBusinessA().firestore().collection('businesses').doc(BUS_B).collection('products').doc('prod1')
        .set({ businessId: BUS_B, name: 'Overwritten', retailPrice: 1 })
    );
  });
});

describe('A worker (not owner) from one tenant tried against another tenant', () => {
  test('A worker-role account from Business A CANNOT read Business B products ❌', async () => {
    await assertFails(
      asBusinessAWorker().firestore().collection('businesses').doc(BUS_B).collection('products').doc('prod1').get()
    );
  });

  test('A worker-role account from Business A CANNOT write Business B products ❌', async () => {
    await assertFails(
      asBusinessAWorker().firestore().collection('businesses').doc(BUS_B).collection('products').doc('hack')
        .set({ businessId: BUS_B, name: 'Hacked', retailPrice: 1 })
    );
  });

  test('A worker-role account CAN still read their own business\'s products ✅ (sanity check — role alone shouldn\'t block same-tenant access)', async () => {
    await assertSucceeds(
      asBusinessAWorker().firestore().collection('businesses').doc(BUS_A).collection('products').doc('prod1').get()
    );
  });
});

describe('Tenant vs. platform console — must never cross', () => {
  test('A tenant member CANNOT read the platform operators directory ❌', async () => {
    await assertFails(
      asBusinessA().firestore().collection('platformOperators').doc('root-uid').get()
    );
  });

  test('A tenant member CANNOT write to their own business\'s registry entry (e.g. change their own fee override) ❌', async () => {
    await assertFails(
      asBusinessA().firestore().collection('businesses').doc(BUS_A).update({ platformFeeRateOverride: 0 })
    );
  });

  test('A tenant member CANNOT read another business\'s registry entry ❌', async () => {
    await assertFails(
      asBusinessA().firestore().collection('businesses').doc(BUS_B).get()
    );
  });

  test('The platform operator CAN read any business\'s registry entry ✅', async () => {
    await assertSucceeds(asPlatformOperator().firestore().collection('businesses').doc(BUS_A).get());
    await assertSucceeds(asPlatformOperator().firestore().collection('businesses').doc(BUS_B).get());
  });

  test('The platform operator alone (no businessId claim) CANNOT read tenant PRODUCT data — by design, not yet granted ❌', async () => {
    // This is deliberate, not an oversight — documented in firestore.rules
    // and in the audit notes. Support/oversight access into live tenant
    // data is a separate decision that hasn't been made yet, so the
    // boundary defaults to closed rather than assuming operators should
    // see everything.
    await assertFails(
      asPlatformOperator().firestore().collection('businesses').doc(BUS_A).collection('products').doc('prod1').get()
    );
  });

  test('The platform operator CAN write to the business registry (e.g. suspend a tenant) ✅', async () => {
    await assertSucceeds(
      asPlatformOperator().firestore().collection('businesses').doc(BUS_A).update({ status: 'suspended' })
    );
  });
});

describe('Unauthenticated access — must be denied everywhere', () => {
  test('Unauthenticated request CANNOT read tenant products ❌', async () => {
    await assertFails(
      asAnonymous().firestore().collection('businesses').doc(BUS_A).collection('products').doc('prod1').get()
    );
  });

  test('Unauthenticated request CANNOT write tenant products ❌', async () => {
    await assertFails(
      asAnonymous().firestore().collection('businesses').doc(BUS_A).collection('products').doc('hack')
        .set({ businessId: BUS_A, name: 'Hacked', retailPrice: 1 })
    );
  });

  test('Unauthenticated request CANNOT read the business registry ❌', async () => {
    await assertFails(asAnonymous().firestore().collection('businesses').doc(BUS_A).get());
  });

  test('Unauthenticated request CANNOT read the platform operators directory ❌', async () => {
    await assertFails(asAnonymous().firestore().collection('platformOperators').doc('root-uid').get());
  });
});

describe('Forged or wrong businessId — the core boundary rule', () => {
  test('A forged businessId FIELD inside the document (path says A, field claims B) is rejected ❌', async () => {
    await assertFails(
      asBusinessA().firestore().collection('businesses').doc(BUS_A).collection('products').doc('forged')
        .set({ businessId: BUS_B, name: 'Forged field', retailPrice: 1 })
    );
  });

  test('A businessId field that matches the path is accepted ✅ (sanity check for the test above)', async () => {
    await assertSucceeds(
      asBusinessA().firestore().collection('businesses').doc(BUS_A).collection('products').doc('honest')
        .set({ businessId: BUS_A, name: 'Honest field', retailPrice: 1 })
    );
  });

  test('Omitting the businessId field entirely is still accepted ✅ (the field is optional, only checked if present)', async () => {
    await assertSucceeds(
      asBusinessA().firestore().collection('businesses').doc(BUS_A).collection('products').doc('noField')
        .set({ name: 'No businessId field at all', retailPrice: 1 })
    );
  });

  test('A user with NO businessId claim at all CANNOT read any tenant products ❌', async () => {
    const noClaim = testEnv.authenticatedContext('dave-uid', {}); // logged in, never assigned to any business
    await assertFails(noClaim.firestore().collection('businesses').doc(BUS_A).collection('products').doc('prod1').get());
  });

  test('A businessId claim pointing at a business that does not exist is denied ❌', async () => {
    const ghost = testEnv.authenticatedContext('ghost-uid', { businessId: BUS_NONEXISTENT, role: 'owner' });
    await assertFails(ghost.firestore().collection('businesses').doc(BUS_NONEXISTENT).collection('products').doc('anything').get());
  });

  test('A businessId claim pointing at a SUSPENDED business is denied immediately, without touching that user\'s claim ❌', async () => {
    const suspendedMember = testEnv.authenticatedContext('suspended-uid', { businessId: BUS_SUSPENDED, role: 'owner' });
    await assertFails(suspendedMember.firestore().collection('businesses').doc(BUS_SUSPENDED).collection('products').doc('anything').get());
  });

  test('Suspending a previously-active business immediately locks out its existing members ❌ (proves businessIsActive() is checked live, not cached)', async () => {
    const aliceBeforeSuspend = asBusinessA();
    await assertSucceeds(aliceBeforeSuspend.firestore().collection('businesses').doc(BUS_A).collection('products').doc('prod1').get());

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('businesses').doc(BUS_A).update({ status: 'suspended' });
    });

    const aliceAfterSuspend = asBusinessA();
    await assertFails(aliceAfterSuspend.firestore().collection('businesses').doc(BUS_A).collection('products').doc('prod1').get());
  });
});
