// Usage:
//   node createBusiness.js --name "Elite Customs" --slug elitecustoms
//
// Creates one document in the top-level `businesses` collection — the
// platform's registry of every tenant. This does NOT touch Elite Customs'
// existing live data at all (that's step 03/04, the migration + cutover).
// This step only creates the registry entry that every future step will
// attach to.

const { getAdmin } = require('./lib/firebaseAdmin');
const { generateId } = require('./lib/ids');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  if (!args.name || !args.slug) {
    console.error('Usage: node createBusiness.js --name "Elite Customs" --slug elitecustoms');
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(args.slug)) {
    console.error('Slug must be lowercase letters, numbers, and hyphens only (e.g. "elitecustoms", "sisters-shop").');
    process.exit(1);
  }

  const admin = getAdmin();
  const db = admin.firestore();

  // The slug must be unique across the platform even though it's not the
  // ID — two businesses can't both claim "elitecustoms" as their friendly
  // reference, even if their real internal IDs are different.
  const existing = await db.collection('businesses').where('slug', '==', args.slug).limit(1).get();
  if (!existing.empty) {
    console.error('A business with slug "' + args.slug + '" already exists: ' + existing.docs[0].id);
    process.exit(1);
  }

  // The ID is deliberately NOT derived from the name or slug — per the
  // locked architecture, a business's display name (and even its slug)
  // can change later; the internal ID it's built on never should.
  const businessId = generateId('BUS');

  await db.collection('businesses').doc(businessId).set({
    businessId: businessId,
    displayName: args.name,
    slug: args.slug,
    status: 'active',
    // Left empty on purpose — module/workflow configuration is a
    // deliberate later decision (steps beyond this one), not something to
    // default silently right now. An empty config here should read as
    // "not configured yet," not "configured with defaults nobody chose."
    moduleConfig: {},
    workflowConfig: {},
    platformFeeRateOverride: null, // null = use platformSettings.transactionFeeRate; set here only if this specific tenant negotiated a different rate
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log('\n✅ Business created.');
  console.log('   businessId: ' + businessId);
  console.log('   displayName: ' + args.name);
  console.log('   slug: ' + args.slug);
  console.log('\nSave this businessId — you\'ll need it for assignUserToBusiness.js next.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
