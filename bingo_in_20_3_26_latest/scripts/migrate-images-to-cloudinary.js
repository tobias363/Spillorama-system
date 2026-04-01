#!/usr/bin/env node

/**
 * One-time migration script: uploads existing local images to Cloudinary
 * and updates MongoDB records with the new URLs.
 *
 * Usage:
 *   CLOUDINARY_CLOUD_NAME=xxx CLOUDINARY_API_KEY=xxx CLOUDINARY_API_SECRET=xxx \
 *   MONGO_URI=mongodb+srv://... \
 *   node scripts/migrate-images-to-cloudinary.js
 *
 * Idempotent — skips records whose photo already starts with "http".
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const IMAGES_DIR = path.join(__dirname, '..', 'public', 'profile', 'bingo');

async function migrateCollection(db, collectionName) {
    const collection = db.collection(collectionName);
    const docs = await collection.find({
        photo: { $exists: true, $ne: null, $not: /^https?:\/\// }
    }).toArray();

    console.log(`\n[${collectionName}] Found ${docs.length} records to migrate`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of docs) {
        const filename = doc.photo;
        const filePath = path.join(IMAGES_DIR, filename);

        if (!fs.existsSync(filePath)) {
            console.log(`  SKIP ${filename} — file not found on disk`);
            skipped++;
            continue;
        }

        try {
            const ext = path.extname(filename).slice(1);
            const publicId = path.basename(filename, '.' + ext);

            const result = await cloudinary.uploader.upload(filePath, {
                folder: 'bingo',
                public_id: publicId,
            });

            await collection.updateOne(
                { _id: doc._id },
                { $set: { photo: result.secure_url } }
            );

            console.log(`  OK   ${filename} -> ${result.secure_url}`);
            migrated++;
        } catch (err) {
            console.error(`  FAIL ${filename}: ${err.message}`);
            failed++;
        }
    }

    return { migrated, skipped, failed };
}

async function main() {
    const requiredVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'MONGO_URI'];
    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length) {
        console.error(`Missing env vars: ${missing.join(', ')}`);
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    console.log('Connected.');

    const collections = ['gametypes', 'backgrounds'];
    const totals = { migrated: 0, skipped: 0, failed: 0 };

    for (const name of collections) {
        const result = await migrateCollection(db, name);
        totals.migrated += result.migrated;
        totals.skipped += result.skipped;
        totals.failed += result.failed;
    }

    console.log('\n--- Summary ---');
    console.log(`Migrated: ${totals.migrated}`);
    console.log(`Skipped:  ${totals.skipped} (file not on disk)`);
    console.log(`Failed:   ${totals.failed}`);

    await mongoose.disconnect();
    console.log('Done.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
