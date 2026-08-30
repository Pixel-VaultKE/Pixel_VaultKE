// Usage:
//   node assignUserToBusiness.js --email owner@elitecustoms.co.ke --businessId BUS_7hK2mQx9Pw4t --role owner
//   node assignUserToBusiness.js --email x@y.com --businessId BUS_xxx --role worker --force   (only to assign into a non-active business, deliberately)
//
// The user must already have a Firebase Authentication account. Per the
// locked architecture, a tenant user belongs to exactly ONE business —
// running this again for the same email with a different businessId
// MOVES them, it doesn't add a second membership. That's deliberate:
// "no business switcher" means the data model shouldn't secretly support
// one either.

const { getAdmin } = require('./lib/firebaseAdmin');
const { generateId } = require('./lib/ids');

const VALID_ROLES = ['owner', 'admin', 'worker'];

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') { args.force = true; continue; }
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  if (!args.email || !args.businessId || !args.role) {
    console.error('Usage: node assignUserToBusiness.js --email x@y.com --businessId BUS_xxx --role owner|admin|worker [--force]');
    process.exit(1);
  }
  if (!VALID_ROLES.includes(args.role)) {
    console.error('Role must be one of: ' + VALID_ROLES.join(', '));
    process.exit(1);
  }

  const admin = getAdmin();
  const auth = admin.auth();
  const db = admin.firestore();

  const businessDoc = await db.collection('businesses').doc(args.businessId).get();
  if (!businessDoc.exists) {
    console.error('No business found with ID ' + args.businessId + ' — run createBusiness.js first.');
    process.exit(1);
  }
  // Hard stop by default, not a warning — assigning someone into a
  // suspended/inactive business almost certainly isn't what you meant to
  // do. --force exists for the rare case it actually is intentional.
  if (businessDoc.data().status !== 'active' && !args.force) {
    console.error('Business ' + args.businessId + ' is not active (status: ' + businessDoc.data().status + ').');
    console.error('Re-run with --force if you really mean to assign someone into it anyway.');
    process.exit(1);
  }

  let user;
  try {
    user = await auth.getUserByEmail(args.email);
  } catch (e) {
    console.error('No Firebase Authentication account exists for ' + args.email + ' yet.');
    console.error('Create one first: Firebase Console → Authentication → Add user.');
    process.exit(1);
  }

  // A stable, portable reference for audit logs and ledger entries —
  // separate from the Firebase Auth UID, which stays the actual
  // document key (so security rules can keep doing simple, cheap direct
  // lookups by request.auth.uid, no extra query needed).
  const existingClaims = user.customClaims || {};
  const userId = existingClaims.userId || generateId('USR');
  const previousBusinessId = existingClaims.businessId || null;

  await auth.setCustomUserClaims(user.uid, Object.assign({}, existingClaims, {
    businessId: args.businessId,
    role: args.role,
    userId: userId
  }));

  await db.collection('businesses').doc(args.businessId)
    .collection('workers').doc(user.uid)
    .set({
      userId: userId,
      email: args.email,
      role: args.role,
      status: 'active',
      assignedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

  // This is the actual fix from the audit: reassigning someone used to
  // leave their old business's profile document sitting there looking
  // "active" forever — access-denied once their claim changed (safe), but
  // a misleading, orphaned record all the same. Mark it removed instead
  // of silently abandoning it, so anyone reading that business's worker
  // list later (support/oversight, a future admin UI) sees the truth.
  if (previousBusinessId && previousBusinessId !== args.businessId) {
    await db.collection('businesses').doc(previousBusinessId)
      .collection('workers').doc(user.uid)
      .set({ status: 'removed', removedAt: admin.firestore.FieldValue.serverTimestamp(), removedReason: 'reassigned to ' + args.businessId }, { merge: true });
    console.log('   (Removed from previous business ' + previousBusinessId + ' — marked removed, not deleted, for audit history.)');
  }

  console.log('\n✅ ' + args.email + ' assigned to ' + businessDoc.data().displayName + ' (' + args.businessId + ') as ' + args.role + '.');
  console.log('   userId: ' + userId);
  console.log('   They must sign out and back in for the new claim to take effect in their session.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
