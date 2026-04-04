/**
 * Seed-script: Legger til CandyMania som gameType i MongoDB.
 *
 * Bruk:
 *   MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/bingo_game node scripts/seed-candy-mania.js
 *
 * Scriptet er idempotent — kjører du det flere ganger oppdateres
 * eksisterende dokument i stedet for å lage duplikater.
 */

const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌  Mangler MONGO_URI. Kjør slik:');
  console.error('   MONGO_URI=mongodb+srv://... node scripts/seed-candy-mania.js');
  process.exit(1);
}

const candyManiaDoc = {
  name: 'Candy Mania',
  type: 'candy_mania',           // slug brukt i lobby
  pattern: false,
  photo: 'profile/bingo/candy-mania-thumb.png',
  row: '0',
  columns: '0',
  totalNoTickets: '0',
  userMaxTickets: '0',
  pickLuckyNumber: [],
  rangeMin: '0',
  rangeMax: '0',
  externalUrl: '/candy/',        // iframe-rute (ny felt for eksterne spill)
  updatedAt: new Date(),
  createdAt: new Date(),
};

async function seed() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('✅  Koblet til MongoDB');

    const db = client.db();                    // bruker databasen i URI-en
    const col = db.collection('gameType');

    // Upsert: oppdater hvis type finnes, ellers opprett
    const result = await col.updateOne(
      { type: 'candy_mania' },
      { $set: candyManiaDoc },
      { upsert: true }
    );

    if (result.upsertedCount === 1) {
      console.log('🆕  CandyMania gameType opprettet (ny)');
    } else if (result.modifiedCount === 1) {
      console.log('🔄  CandyMania gameType oppdatert (fantes fra før)');
    } else {
      console.log('ℹ️   Ingen endring — dokumentet er allerede oppdatert');
    }

    // Verifiser
    const doc = await col.findOne({ type: 'candy_mania' });
    console.log('\nLagret dokument:');
    console.log(JSON.stringify(doc, null, 2));

  } catch (err) {
    console.error('❌  Feil:', err.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔒  Tilkobling lukket');
  }
}

seed();
