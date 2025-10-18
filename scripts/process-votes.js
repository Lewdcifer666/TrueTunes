const fs = require('fs');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || 'Lewdcifer666/truetunes';
const MIN_VOTES = 10;
const AI_THRESHOLD = 0.75;

// Fetch GitHub issues
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

// Close issue
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

// Parse vote from issue
function parseVote(issue) {
    const body = issue.body || '';
    const title = issue.title || '';
    
    // Extract artist name from title
    const artistMatch = title.match(/Vote:\s*(.+)/);
    if (!artistMatch) return null;
    
    // Extract platform and ID
    const platformMatch = body.match(/Platform:\s*(\w+)/i);
    const idMatch = body.match(/(?:Artist )?ID:\s*([^\s\n]+)/i);
    const voteMatch = body.match(/Vote:\s*(ai|human)/i);
    
    if (!platformMatch || !idMatch || !voteMatch) return null;
    
    return {
        artist: artistMatch[1].trim(),
        platform: platformMatch[1].toLowerCase(),
        id: idMatch[1].trim(),
        vote: voteMatch[1].toLowerCase(),
        issueNumber: issue.number
    };
}

// Main processing
async function main() {
    console.log('Fetching issues...');
    const issues = await fetchIssues();
    console.log(`Found ${issues.length} open vote issues`);
    
    if (issues.length === 0) {
        console.log('No votes to process');
        return;
    }
    
    // Load current data
    const flagged = JSON.parse(fs.readFileSync('data/flagged.json', 'utf8'));
    const pending = JSON.parse(fs.readFileSync('data/pending.json', 'utf8'));
    const stats = JSON.parse(fs.readFileSync('data/stats.json', 'utf8'));
    
    // Process votes
    const artistVotes = new Map();
    const processedIssues = [];
    
    for (const issue of issues) {
        const vote = parseVote(issue);
        if (!vote) {
            console.log(`Skipping issue #${issue.number}: invalid format`);
            continue;
        }
        
        const key = `${vote.platform}:${vote.id}`;
        
        if (!artistVotes.has(key)) {
            artistVotes.set(key, {
                name: vote.artist,
                platform: vote.platform,
                id: vote.id,
                aiVotes: 0,
                humanVotes: 0
            });
        }
        
        const data = artistVotes.get(key);
        if (vote.vote === 'ai') {
            data.aiVotes++;
        } else {
            data.humanVotes++;
        }
        
        processedIssues.push(issue.number);
    }
    
    // Update pending artists
    for (const [key, data] of artistVotes) {
        const existing = pending.artists.find(a => 
            a.platforms[data.platform] === data.id
        );
        
        if (existing) {
            existing.votes.ai += data.aiVotes;
            existing.votes.human += data.humanVotes;
        } else {
            pending.artists.push({
                id: key,
                name: data.name,
                platforms: { [data.platform]: data.id },
                votes: { ai: data.aiVotes, human: data.humanVotes },
                confidence: 0,
                added: new Date().toISOString()
            });
        }
    }
    
    // Check thresholds and move to flagged
    const now = new Date().toISOString();
    let newlyFlagged = 0;
    
    pending.artists = pending.artists.filter(artist => {
        const total = artist.votes.ai + artist.votes.human;
        
        if (total >= MIN_VOTES) {
            const confidence = artist.votes.ai / total;
            artist.confidence = confidence;
            
            if (confidence >= AI_THRESHOLD) {
                // Move to flagged
                flagged.artists.push(artist);
                newlyFlagged++;
                return false;
            }
        }
        
        return true;
    });
    
    // Update stats
    stats.totalArtists = flagged.artists.length + pending.artists.length;
    stats.flaggedArtists = flagged.artists.length;
    stats.votesToday = processedIssues.length;
    stats.votesTotal += processedIssues.length;
    stats.lastUpdated = now;
    
    // Update file metadata
    flagged.version = now;
    flagged.updated = now;
    flagged.total = flagged.artists.length;
    
    pending.version = now;
    pending.updated = now;
    
    // Save files
    fs.writeFileSync('data/flagged.json', JSON.stringify(flagged, null, 2));
    fs.writeFileSync('data/pending.json', JSON.stringify(pending, null, 2));
    fs.writeFileSync('data/stats.json', JSON.stringify(stats, null, 2));
    
    console.log(`Processed ${processedIssues.length} votes`);
    console.log(`${newlyFlagged} artists newly flagged`);
    console.log(`${pending.artists.length} artists pending`);
    console.log(`${flagged.artists.length} total flagged artists`);
    
    // Close processed issues
    for (const issueNumber of processedIssues) {
        await closeIssue(issueNumber);
        console.log(`Closed issue #${issueNumber}`);
    }
    
    console.log('Done!');
}

main().catch(console.error);