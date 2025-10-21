const fs = require('fs');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || 'Lewdcifer666/TrueTunes';
const MIN_VOTES = 10;
const MAX_VOTES_PER_USER = 20;

function fetchIssues() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${REPO}/issues?labels=vote&state=open&per_page=100`,
            headers: {
                'User-Agent': 'TrueTunes-Bot',
                'Authorization': `token ${GITHUB_TOKEN}`
            }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

function closeIssue(issueNumber) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ state: 'closed' });
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${REPO}/issues/${issueNumber}`,
            method: 'PATCH',
            headers: {
                'User-Agent': 'TrueTunes-Bot',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'Content-Length': postData.length
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

function parseVote(issue) {
    const body = issue.body || '';
    const title = issue.title || '';

    const artistMatch = title.match(/Vote:\s*(.+)/);
    if (!artistMatch) return null;

    const platformMatch = body.match(/Platform:\s*(\w+)/i);
    const idMatch = body.match(/(?:Artist )?ID:\s*([^\s\n]+)/i);
    const voteMatch = body.match(/Vote:\s*ai/i);

    if (!platformMatch || !idMatch || !voteMatch) return null;

    return {
        artist: artistMatch[1].trim(),
        platform: platformMatch[1].toLowerCase(),
        id: idMatch[1].trim(),
        issueNumber: issue.number,
        reporter: issue.user.login
    };
}

async function main() {
    console.log('Fetching issues...');
    const issues = await fetchIssues();
    console.log(`Found ${issues.length} open vote issues`);

    if (issues.length === 0) {
        console.log('No votes to process');
        return;
    }

    const flagged = JSON.parse(fs.readFileSync('data/flagged.json', 'utf8'));
    const pending = JSON.parse(fs.readFileSync('data/pending.json', 'utf8'));
    const stats = JSON.parse(fs.readFileSync('data/stats.json', 'utf8'));

    const artistVotes = new Map();
    const processedIssues = []; // Issues to close (only duplicates/invalid)
    const issuesToClose = [];    // NEW: Only issues for artists that reached threshold
    const userVoteCount = new Map();

    for (const issue of issues) {
        const vote = parseVote(issue);
        if (!vote) {
            console.log(`Skipping issue #${issue.number}: invalid format`);
            processedIssues.push(issue.number);
            continue;
        }

        // Rate limiting
        const userCount = userVoteCount.get(vote.reporter) || 0;
        if (userCount >= MAX_VOTES_PER_USER) {
            console.log(`⚠ User ${vote.reporter} exceeded rate limit (${userCount} votes) - IGNORED`);
            processedIssues.push(issue.number);
            continue;
        }
        userVoteCount.set(vote.reporter, userCount + 1);

        const key = `${vote.platform}:${vote.id}`;

        if (!artistVotes.has(key)) {
            artistVotes.set(key, {
                name: vote.artist,
                platform: vote.platform,
                id: vote.id,
                reporters: new Set(),
                issueNumbers: [] // NEW: Track all issue numbers for this artist
            });
        }

        const data = artistVotes.get(key);

        // Check if user already voted for this artist
        if (!data.reporters.has(vote.reporter)) {
            data.reporters.add(vote.reporter);
            data.issueNumbers.push(issue.number); // Track this issue
            console.log(`✓ Counted vote from ${vote.reporter} for ${vote.artist}`);
        } else {
            console.log(`⚠ Duplicate vote from ${vote.reporter} for ${vote.artist} - CLOSING DUPLICATE`);
            processedIssues.push(issue.number); // Close duplicate
        }
    }

    // Update pending artists
    for (const [key, data] of artistVotes) {
        const existing = pending.artists.find(a =>
            a.platforms[data.platform] === data.id
        );

        if (existing) {
            // Merge new reporters with existing ones
            const existingReporters = new Set(existing.reporters || []);
            data.reporters.forEach(reporter => existingReporters.add(reporter));
            existing.reporters = Array.from(existingReporters);
            existing.votes = existing.reporters.length;
            console.log(`Updated existing pending artist: ${data.name} (${existing.votes}/${MIN_VOTES} votes)`);
        } else {
            pending.artists.push({
                id: key,
                name: data.name,
                platforms: { [data.platform]: data.id },
                votes: data.reporters.size,
                reporters: Array.from(data.reporters),
                added: new Date().toISOString()
            });
            console.log(`Added new pending artist: ${data.name} (${data.reporters.size}/${MIN_VOTES} votes)`);
        }
    }

    // Move to flagged if threshold met AND close related issues
    const now = new Date().toISOString();
    let newlyFlagged = 0;

    pending.artists = pending.artists.filter(artist => {
        if (artist.votes >= MIN_VOTES) {
            flagged.artists.push(artist);
            newlyFlagged++;
            console.log(`🚩 Flagged: ${artist.name} with ${artist.votes} votes - CLOSING ALL RELATED ISSUES`);

            // NEW: Find all issues for this artist and close them
            const artistKey = artist.id;
            if (artistVotes.has(artistKey)) {
                const artistData = artistVotes.get(artistKey);
                issuesToClose.push(...artistData.issueNumbers);
            }

            return false; // Remove from pending
        }
        return true; // Keep in pending
    });

    // Update stats
    stats.totalArtists = flagged.artists.length + pending.artists.length;
    stats.flaggedArtists = flagged.artists.length;
    stats.votesToday = processedIssues.length + issuesToClose.length;
    stats.votesTotal += processedIssues.length + issuesToClose.length;
    stats.lastUpdated = now;

    flagged.version = now;
    flagged.updated = now;
    flagged.total = flagged.artists.length;

    pending.version = now;
    pending.updated = now;

    fs.writeFileSync('data/flagged.json', JSON.stringify(flagged, null, 2));
    fs.writeFileSync('data/pending.json', JSON.stringify(pending, null, 2));
    fs.writeFileSync('data/stats.json', JSON.stringify(stats, null, 2));

    console.log(`\n=== Summary ===`);
    console.log(`Processed ${issues.length} total issues`);
    console.log(`${newlyFlagged} artists newly flagged`);
    console.log(`${pending.artists.length} artists pending (need ${MIN_VOTES} votes)`);
    console.log(`${flagged.artists.length} total flagged artists`);
    console.log(`Closing ${processedIssues.length} duplicate/invalid issues`);
    console.log(`Closing ${issuesToClose.length} issues (threshold reached)`);

    // Close only invalid/duplicate issues
    for (const issueNumber of processedIssues) {
        await closeIssue(issueNumber);
        console.log(`Closed issue #${issueNumber} (invalid/duplicate)`);
    }

    // Close issues for artists that reached threshold
    for (const issueNumber of issuesToClose) {
        await closeIssue(issueNumber);
        console.log(`Closed issue #${issueNumber} (artist flagged)`);
    }

    console.log('Done!');
}

main().catch(console.error);