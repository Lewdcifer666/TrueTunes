#!/usr/bin/env node

/**
 * TrueTunes Data File Initializer
 * 
 * This script creates or resets the data files needed by process-votes.js
 * Run this if you get "ENOENT" errors or invalid JSON errors
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 TrueTunes Data File Initializer\n');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
    console.log('📁 Creating data directory...');
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('✓ Created: data/\n');
} else {
    console.log('✓ Data directory exists\n');
}

// Define the data file templates
const templates = {
    'flagged.json': {
        version: new Date().toISOString(),
        updated: new Date().toISOString(),
        total: 5,
        artists: [
            {
                id: "test1",
                name: "AI Test Artist 1",
                platforms: {
                    spotify: "3TVXtAsR1Inumwj472S9r4"
                },
                votes: 15,
                added: "2025-10-18T00:00:00Z"
            },
            {
                id: "test2",
                name: "Digital Dreams Band",
                platforms: {
                    youtube: "UCtest123456"
                },
                votes: 12,
                added: "2025-10-18T00:00:00Z"
            },
            {
                id: "test3",
                name: "Synthetic Sounds",
                platforms: {
                    spotify: "1dfeR4HaWDbWqFHLkxsg1d"
                },
                votes: 20,
                added: "2025-10-18T00:00:00Z"
            },
            {
                id: "test_detection",
                name: "Test Artist for Detection",
                platforms: {
                    spotify: "2WRavyZrFClZuCdi5v5OSu"
                },
                votes: 15,
                added: "2025-10-18T00:00:00Z"
            },
            {
                id: "spotify:07XIuuPrpw0kcGrJApsbQp",
                name: "Deathly Hours",
                platforms: {
                    spotify: "07XIuuPrpw0kcGrJApsbQp"
                },
                votes: 10,
                added: "2025-10-19T16:58:02.118Z"
            }
        ]
    },

    'pending.json': {
        version: new Date().toISOString(),
        updated: new Date().toISOString(),
        artists: [
            {
                id: "spotify:6CrsGj3Zj4gIM3rQSU7DeW",
                name: "Bleeding Verse",
                platforms: {
                    spotify: "6CrsGj3Zj4gIM3rQSU7DeW"
                },
                votes: 1,
                reporters: ["Lewdcifer666"],
                added: "2025-10-19T17:55:27.019Z"
            },
            {
                id: "spotify:2GRtyAXWUiisGYub5SGMrb",
                name: "The Velvet Sundown",
                platforms: {
                    spotify: "2GRtyAXWUiisGYub5SGMrb"
                },
                votes: 1,
                reporters: ["Lewdcifer666"],
                added: "2025-10-19T23:10:59.777Z"
            },
            {
                id: "spotify:0a97V3mDhGyNg93Dcf9Ahj",
                name: "Aventhis",
                platforms: {
                    spotify: "0a97V3mDhGyNg93Dcf9Ahj"
                },
                votes: 1,
                reporters: ["Lewdcifer666"],
                added: "2025-10-22T20:49:26.335Z"
            }
        ]
    },

    'stats.json': {
        totalArtists: 8,
        flaggedArtists: 5,
        votesToday: 0,
        votesTotal: 18,
        lastUpdated: new Date().toISOString()
    }
};

// Process each file
let filesCreated = 0;
let filesSkipped = 0;
let filesBackedUp = 0;

for (const [filename, template] of Object.entries(templates)) {
    const filePath = path.join(dataDir, filename);

    console.log(`\n📄 Processing ${filename}...`);

    // Check if file exists
    if (fs.existsSync(filePath)) {
        console.log('   ⚠️  File already exists');

        // Try to validate existing JSON
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            JSON.parse(content);
            console.log('   ✓ Existing file has valid JSON');
            console.log('   ℹ️  Skipping (use --force to overwrite)');
            filesSkipped++;
            continue;
        } catch (e) {
            console.log('   ❌ Existing file has INVALID JSON!');
            console.log(`   Error: ${e.message}`);

            // Backup the corrupted file
            const backupPath = filePath + '.backup.' + Date.now();
            fs.copyFileSync(filePath, backupPath);
            console.log(`   💾 Backed up to: ${path.basename(backupPath)}`);
            filesBackedUp++;
        }
    }

    // Write the template
    try {
        const jsonString = JSON.stringify(template, null, 2);
        fs.writeFileSync(filePath, jsonString, 'utf8');
        console.log('   ✓ Created/Updated successfully');
        console.log(`   📊 Size: ${jsonString.length} bytes`);
        filesCreated++;
    } catch (e) {
        console.error(`   ❌ Failed to write file: ${e.message}`);
    }
}

// Summary
console.log('\n' + '═'.repeat(60));
console.log('📊 SUMMARY');
console.log('═'.repeat(60));
console.log(`Files created/updated: ${filesCreated}`);
console.log(`Files skipped: ${filesSkipped}`);
console.log(`Files backed up: ${filesBackedUp}`);

if (filesCreated > 0 || filesBackedUp > 0) {
    console.log('\n✅ Data files are ready!');
    console.log('\nNext steps:');
    console.log('1. Commit these files: git add data/*.json');
    console.log('2. git commit -m "Initialize data files"');
    console.log('3. git push');
    console.log('4. Run the workflow to process votes');
} else {
    console.log('\n✓ All data files already exist and are valid');
}

console.log('\n💡 To force overwrite existing files, run:');
console.log('   node scripts/init-data.js --force\n');

// Check for --force flag
if (process.argv.includes('--force')) {
    console.log('🔄 FORCE MODE: This will overwrite all existing files!\n');
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    readline.question('Are you sure? (yes/no): ', (answer) => {
        if (answer.toLowerCase() === 'yes') {
            console.log('\n🔥 Overwriting all files...');
            // Re-run the creation process without checks
            for (const [filename, template] of Object.entries(templates)) {
                const filePath = path.join(dataDir, filename);
                const jsonString = JSON.stringify(template, null, 2);
                fs.writeFileSync(filePath, jsonString, 'utf8');
                console.log(`   ✓ Overwrote ${filename}`);
            }
            console.log('\n✅ All files overwritten!');
        } else {
            console.log('\n❌ Aborted');
        }
        readline.close();
    });
}