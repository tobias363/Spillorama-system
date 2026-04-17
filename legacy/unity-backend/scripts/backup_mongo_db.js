#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

function readEnvFile(envPath) {
  const raw = fs.readFileSync(envPath, 'utf8');
  const vars = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    vars[key] = value;
  }
  return vars;
}

async function main() {
  const envPath = process.argv[2] || path.join(__dirname, '..', '.env.recovery');
  const outputRoot =
    process.argv[3] || path.join(__dirname, '..', 'recovery-backups');

  const vars = readEnvFile(envPath);
  const uri = vars.MONGO_URI;
  if (!uri) {
    throw new Error(`MONGO_URI mangler i ${envPath}`);
  }

  const parsed = new URL(uri);
  const dbName = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : 'test';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(outputRoot, `${dbName}_${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();
    const manifest = {
      dbName,
      createdAt: new Date().toISOString(),
      collectionCount: collections.length,
      collections: [],
    };

    for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
      const docs = await db.collection(name).find({}).toArray();
      const filePath = path.join(backupDir, `${name}.json`);
      fs.writeFileSync(filePath, EJSON.stringify(docs, null, 2), 'utf8');
      manifest.collections.push({
        name,
        count: docs.length,
        file: `${name}.json`,
      });
    }

    fs.writeFileSync(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    console.log(JSON.stringify({ backupDir, manifest }, null, 2));
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
