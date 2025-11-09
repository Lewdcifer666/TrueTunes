// TrueTunes Spicetify Extension - Full Featured with Community Feed
// Detects AI-generated music on Spotify

(function TrueTunes() {
    const GITHUB_RAW = "https://raw.githubusercontent.com/Lewdcifer666/TrueTunes/main/data/flagged.json";
    const GITHUB_API = "https://api.github.com/repos/Lewdcifer666/TrueTunes/issues";
    const ISSUE_URL = "https://github.com/Lewdcifer666/TrueTunes/issues/new";
    const ADMIN_USERS = ['Lewdcifer666'];
    const ADMIN_BYPASS_DUPLICATE_CHECK = true;

    // GitHub Device Flow OAuth
    const GITHUB_CLIENT_ID = "Ov23liuuPQQQ8ydHDkOm";
    const PROXY_URL = "https://192.168.2.207:8888";
    const DEVICE_CODE_URL = `${PROXY_URL}/device/code`;
    const TOKEN_URL = `${PROXY_URL}/device/token`;
    const DEVICE_AUTH_URL = "https://github.com/login/device";

    let flaggedArtists = new Map();
    let votedArtists = new Map();
    let isProcessing = false;
    let currentTab = 'account';
    let spicyLyricsWatcherActive = false;
    let skipButtonInitialized = false;
    let spicyWatcherRunning = false;

    let settings = {
        githubToken: null,
        githubUsername: null,
        githubAvatar: null,
        githubLinked: false,
        autoSkip: false,
        autoHide: false,
        autoDislike: false,
        showWarnings: true,
        highlightInPlaylists: true,
        verificationInterval: 30000
    };

    let userStats = {
        totalVotes: 0,
        votedArtists: [],
        lastVerified: null
    };

    let communityFeed = {
        recentActivity: [],
        lastUpdated: null,
        updateTimer: null
    };

    let historyView = {
        mode: 'side-by-side',
        displayedCount: 20,
        loadMoreStep: 20
    };

    let communityView = {
        displayedCount: 10,
        loadMoreStep: 10,
        isUpdating: false
    };

    // ===== DEBOUNCING & STATE MANAGEMENT =====
    let artistPageButtonDebounce = null;
    let lastProcessedArtistId = null;
    let adminLogThrottle = { lastLog: 0, interval: 60000 }; // Log once per minute

    // ===== ADMIN CHECK FUNCTION =====
    function isAdmin() {
        return settings.githubLinked && ADMIN_USERS.includes(settings.githubUsername);
    }

    // ===== GITHUB DEVICE FLOW OAUTH =====

    async function startGithubDeviceFlow() {
        try {
            Spicetify.showNotification('🔄 Initializing GitHub authentication...', false, 2000);

            const deviceCodeResponse = await fetch(DEVICE_CODE_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    client_id: GITHUB_CLIENT_ID,
                    scope: 'read:user'
                })
            });

            if (!deviceCodeResponse.ok) {
                throw new Error(`HTTP ${deviceCodeResponse.status}: ${deviceCodeResponse.statusText}`);
            }

            const deviceData = await deviceCodeResponse.json();

            if (!deviceData.device_code || !deviceData.user_code) {
                throw new Error('Invalid response from device code endpoint');
            }

            showDeviceCodeModal(deviceData);

            try {
                await pollForDeviceAuthorization(
                    deviceData.device_code,
                    deviceData.interval || 5,
                    deviceData.expires_in || 900
                );

            } catch (pollError) {
                document.getElementById('truetunes-device-modal')?.remove();

                if (pollError.message !== 'User cancelled') {
                    Spicetify.showNotification('❌ ' + pollError.message, true, 4000);
                }
            }

        } catch (error) {
            document.getElementById('truetunes-device-modal')?.remove();

            let errorMessage = 'Authentication failed';
            if (error.message.includes('Failed to fetch')) {
                errorMessage = 'Cannot connect to authentication server. Is the proxy running?';
            } else if (error.message.includes('HTTP')) {
                errorMessage = 'Server error: ' + error.message;
            } else {
                errorMessage = error.message;
            }

            Spicetify.showNotification('❌ ' + errorMessage, true, 5000);
        }
    }

    function showDeviceCodeModal(deviceData) {
        document.getElementById('truetunes-device-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'truetunes-device-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            backdrop-filter: blur(10px);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.2s ease;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: linear-gradient(135deg, #1e1e1e 0%, #2a1a4a 100%);
            padding: 48px;
            border-radius: 24px;
            max-width: 500px;
            width: 90%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            border: 2px solid rgba(126, 34, 206, 0.3);
            animation: slideUp 0.3s ease;
        `;

        const timeLeft = Math.floor(deviceData.expires_in / 60);

        content.innerHTML = `
            <div style="font-size: 64px; margin-bottom: 24px;">🔐</div>
            <h2 style="color: white; font-size: 28px; font-weight: 700; margin-bottom: 16px;">
                GitHub Authentication
            </h2>
            <p style="color: #ccc; margin-bottom: 32px; font-size: 16px; line-height: 1.5;">
                To connect your GitHub account, visit the link below and enter this code:
            </p>
            
            <div id="code-container" style="background: rgba(126, 34, 206, 0.2); border: 2px solid #7e22ce; padding: 24px; border-radius: 16px; margin-bottom: 24px; cursor: pointer; transition: all 0.2s;">
                <div style="font-size: 48px; font-weight: 900; letter-spacing: 8px; color: #fff; font-family: monospace;">
                    ${deviceData.user_code}
                </div>
            </div>

            <a href="${deviceData.verification_uri}" 
               target="_blank"
               id="device-flow-link"
               style="display: inline-block; background: linear-gradient(135deg, #7e22ce 0%, #db2777 100%); color: white; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 700; font-size: 18px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(126, 34, 206, 0.4); transition: transform 0.2s;">
                Open GitHub →
            </a>

            <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 24px; padding: 16px; background: rgba(255, 255, 255, 0.05); border-radius: 12px;">
                <div style="width: 12px; height: 12px; border-radius: 50%; background: #22c55e; animation: pulse 2s ease-in-out infinite;"></div>
                <span style="color: #ccc; font-size: 14px;">
                    Waiting for authorization... (${timeLeft} minutes remaining)
                </span>
            </div>

            <button id="device-flow-cancel" style="margin-top: 20px; background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: #999; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 14px;">
                Cancel
            </button>

            <style>
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(1.2); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { 
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to { 
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            </style>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        window.open(deviceData.verification_uri, '_blank');

        const link = document.getElementById('device-flow-link');
        link.addEventListener('mouseenter', () => {
            link.style.transform = 'scale(1.05)';
        });
        link.addEventListener('mouseleave', () => {
            link.style.transform = 'scale(1)';
        });

        const cancelButton = document.getElementById('device-flow-cancel');
        if (cancelButton) {
            cancelButton.addEventListener('click', () => {
                modal.remove();
                Spicetify.showNotification('Authentication cancelled', false, 2000);
            });
        }

        const codeContainer = document.getElementById('code-container');
        codeContainer.addEventListener('click', () => {
            navigator.clipboard.writeText(deviceData.user_code);
            Spicetify.showNotification('✓ Code copied to clipboard', false, 1500);
            codeContainer.style.background = 'rgba(34, 197, 94, 0.2)';
            codeContainer.style.borderColor = '#22c55e';
            setTimeout(() => {
                codeContainer.style.background = 'rgba(126, 34, 206, 0.2)';
                codeContainer.style.borderColor = '#7e22ce';
            }, 1000);
        });
    }

    async function pollForDeviceAuthorization(deviceCode, interval, expiresIn) {
        const startTime = Date.now();
        let currentInterval = (interval || 5) * 1000;
        const timeout = expiresIn * 1000;

        let pollTimer = null;
        let isPolling = false;

        return new Promise((resolve, reject) => {
            const poll = async () => {
                if (isPolling) {
                    return;
                }

                isPolling = true;

                if (Date.now() - startTime > timeout) {
                    if (pollTimer) clearTimeout(pollTimer);
                    document.getElementById('truetunes-device-modal')?.remove();
                    isPolling = false;
                    reject(new Error('Authentication timeout'));
                    return;
                }

                try {
                    const response = await fetch(TOKEN_URL, {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            client_id: GITHUB_CLIENT_ID,
                            device_code: deviceCode,
                            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                        })
                    });

                    const data = await response.json();

                    if (data.error) {
                        if (data.error === 'authorization_pending') {
                            isPolling = false;
                            pollTimer = setTimeout(poll, currentInterval);
                            return;
                        }
                        else if (data.error === 'slow_down') {
                            if (data.interval) {
                                currentInterval = data.interval * 1000;
                            } else {
                                currentInterval += 5000;
                            }
                            isPolling = false;
                            pollTimer = setTimeout(poll, currentInterval);
                            return;
                        }
                        else if (data.error === 'expired_token') {
                            if (pollTimer) clearTimeout(pollTimer);
                            document.getElementById('truetunes-device-modal')?.remove();
                            isPolling = false;
                            reject(new Error('Code expired'));
                            return;
                        }
                        else if (data.error === 'access_denied') {
                            if (pollTimer) clearTimeout(pollTimer);
                            document.getElementById('truetunes-device-modal')?.remove();
                            isPolling = false;
                            reject(new Error('Access denied by user'));
                            return;
                        }
                        else {
                            isPolling = false;
                            pollTimer = setTimeout(poll, currentInterval);
                            return;
                        }
                    }

                    if (data.access_token) {
                        if (pollTimer) {
                            clearTimeout(pollTimer);
                            pollTimer = null;
                        }

                        isPolling = false;

                        document.getElementById('truetunes-device-modal')?.remove();

                        try {
                            const userData = await getUserData(data.access_token);
                            await completeGithubAuth(data.access_token, userData);
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                        return;
                    }

                    isPolling = false;
                    pollTimer = setTimeout(poll, currentInterval);

                } catch (error) {
                    isPolling = false;
                    pollTimer = setTimeout(poll, currentInterval);
                }
            };

            poll();
        });
    }

    async function getUserData(accessToken) {
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user data');
        }

        return await response.json();
    }

    async function completeGithubAuth(token, userData) {
        settings.githubToken = token;
        settings.githubUsername = userData.login;
        settings.githubAvatar = userData.avatar_url;
        settings.githubLinked = true;
        saveSettings();

        // Check if user is admin - LOG ONLY ONCE
        if (isAdmin()) {
            console.log('[TrueTunes] Admin mode enabled for', userData.login);
            Spicetify.showNotification(`✓ Logged in as ${userData.login} [ADMIN]`, false, 3000);
        } else {
            Spicetify.showNotification(`✓ Logged in as ${userData.login}`, false, 3000);
        }

        await verifyRecentVotes();
        startCommunityFeedUpdates();

        const modal = document.getElementById('truetunes-modal');
        if (modal) {
            modal.remove();
            setTimeout(() => showTrueTunesPanel(), 300);
        }
    }

    function logoutGithub() {
        settings.githubToken = null;
        settings.githubUsername = null;
        settings.githubAvatar = null;
        settings.githubLinked = false;
        votedArtists.clear();
        userStats = { totalVotes: 0, votedArtists: [], lastVerified: null };
        stopCommunityFeedUpdates();
        saveSettings();
        saveUserStats();
        Spicetify.showNotification('Logged out from GitHub', false, 2000);
        renderTrueTunesPanel();
    }

    // ===== SETTINGS MANAGEMENT =====

    function loadSettings() {
        try {
            const saved = localStorage.getItem('truetunes_settings');
            if (saved) {
                settings = { ...settings, ...JSON.parse(saved) };
            }

            const savedHistoryView = localStorage.getItem('truetunes_history_view');
            if (savedHistoryView) {
                historyView = { ...historyView, ...JSON.parse(savedHistoryView) };
            }
        } catch (e) {
            console.error('[TrueTunes] Error loading settings:', e);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem('truetunes_settings', JSON.stringify(settings));
            localStorage.setItem('truetunes_history_view', JSON.stringify(historyView));
        } catch (e) {
            console.error('[TrueTunes] Error saving settings:', e);
        }
    }

    function loadUserStats() {
        try {
            const saved = localStorage.getItem('truetunes_user_stats');
            if (saved) {
                userStats = { ...userStats, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error('[TrueTunes] Error loading stats:', e);
        }
    }

    function saveUserStats() {
        try {
            localStorage.setItem('truetunes_user_stats', JSON.stringify(userStats));
        } catch (e) {
            console.error('[TrueTunes] Error saving stats:', e);
        }
    }

    // ===== COMMUNITY FEED =====

    async function fetchCommunityActivity() {
        try {
            console.log('[TrueTunes] Fetching community activity from data files...');

            const [pendingResponse, flaggedResponse] = await Promise.all([
                fetch('https://raw.githubusercontent.com/Lewdcifer666/TrueTunes/main/data/pending.json?t=' + Date.now()),
                fetch('https://raw.githubusercontent.com/Lewdcifer666/TrueTunes/main/data/flagged.json?t=' + Date.now())
            ]);

            const pending = await pendingResponse.json();
            const flagged = await flaggedResponse.json();

            communityFeed.recentActivity = [];

            // Add pending artists
            pending.artists.forEach(artist => {
                const platformKey = Object.keys(artist.platforms)[0];
                const artistId = artist.platforms[platformKey];

                if (artist.reporters && artist.reporters.length > 0) {
                    artist.reporters.forEach(reporter => {
                        communityFeed.recentActivity.push({
                            issueNumbers: artist.issueNumbers || [],
                            artistName: artist.name,
                            artistId: artistId,
                            platform: platformKey,
                            reporter: reporter,
                            reporterAvatar: `https://github.com/${reporter}.png`,
                            createdAt: artist.added,
                            updatedAt: artist.added,
                            state: 'open',
                            comments: 0
                        });
                    });
                }
            });

            // Add flagged artists
            flagged.artists.forEach(artist => {
                const platformKey = Object.keys(artist.platforms)[0];
                const artistId = artist.platforms[platformKey];

                if (artist.reporters && artist.reporters.length > 0) {
                    artist.reporters.forEach(reporter => {
                        communityFeed.recentActivity.push({
                            issueNumbers: artist.issueNumbers || [],
                            artistName: artist.name,
                            artistId: artistId,
                            platform: platformKey,
                            reporter: reporter,
                            reporterAvatar: `https://github.com/${reporter}.png`,
                            createdAt: artist.added,
                            updatedAt: artist.added,
                            state: 'closed',
                            comments: 0
                        });
                    });
                }
            });

            communityFeed.recentActivity.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            );

            communityFeed.lastUpdated = new Date().toISOString();

            console.log(`[TrueTunes] Loaded ${communityFeed.recentActivity.length} activity entries`);
            console.log(`[TrueTunes] Pending: ${pending.artists.length}, Flagged: ${flagged.artists.length}`);

            if (currentTab === 'community' && !communityView.isUpdating) {
                renderTrueTunesPanel();
            } else if (communityView.isUpdating) {
                updateCommunityFeedOnly();
            }
        } catch (error) {
            console.error('[TrueTunes] Error fetching community activity:', error);
        }
    }

    function startCommunityFeedUpdates() {
        fetchCommunityActivity();

        if (communityFeed.updateTimer) {
            clearInterval(communityFeed.updateTimer);
        }

        communityFeed.updateTimer = setInterval(async () => {
            if (currentTab === 'community') {
                const feedContainer = document.getElementById('community-feed-container');
                const savedScrollTop = feedContainer ? feedContainer.scrollTop : 0;
                const savedDisplayCount = communityView.displayedCount;

                communityView.isUpdating = true;
                await fetchCommunityActivity();

                // Preserve display count if user scrolled down
                if (savedScrollTop < 500) {
                    communityView.displayedCount = 10;
                } else {
                    communityView.displayedCount = savedDisplayCount;
                }

                updateCommunityFeedOnly();
                communityView.isUpdating = false;
            }
        }, 10 * 60 * 1000);
    }

    function stopCommunityFeedUpdates() {
        if (communityFeed.updateTimer) {
            clearInterval(communityFeed.updateTimer);
            communityFeed.updateTimer = null;
        }
    }

    // ===== VOTE VERIFICATION =====

    async function verifyRecentVotes() {
        if (!settings.githubLinked || !settings.githubUsername) return;

        try {
            console.log('[TrueTunes] Verifying votes...');
            const headers = settings.githubToken ? {
                'Authorization': `token ${settings.githubToken}`
            } : {};

            const response = await fetch(`${GITHUB_API}?labels=vote&state=all&creator=${settings.githubUsername}&per_page=100`, { headers });
            const issues = await response.json();

            votedArtists.clear();
            userStats.votedArtists = [];

            for (const issue of issues) {
                const body = issue.body || '';
                const artistNameMatch = issue.title.match(/Vote:\s*(.+)/);
                const artistIdMatch = body.match(/Artist ID:\s*([^\s\n]+)/);

                if (artistIdMatch) {
                    const rawArtistId = artistIdMatch[1];
                    // Normalize to just the ID (remove spotify: prefix if present)
                    const artistId = rawArtistId.replace(/^spotify:/, '');
                    const artistName = artistNameMatch ? artistNameMatch[1] : 'Unknown';

                    votedArtists.set(artistId, {
                        issueNumber: issue.number,
                        artistName: artistName,
                        createdAt: issue.created_at,
                        state: issue.state
                    });

                    userStats.votedArtists.push({
                        artistId,
                        artistName,
                        issueNumber: issue.number,
                        createdAt: issue.created_at,
                        state: issue.state
                    });
                }
            }

            userStats.totalVotes = votedArtists.size;
            userStats.lastVerified = new Date().toISOString();
            saveUserStats();
            saveVotedArtists();

            highlightPlaylistItems();

            console.log(`[TrueTunes] Verified ${userStats.totalVotes} votes`);

            // REMOVED: Excessive admin logging
            if (isAdmin()) {
                // Only log once per verification, not constantly
            }
        } catch (e) {
            console.error('[TrueTunes] Error verifying votes:', e);
        }
    }

    function loadVotedArtists() {
        try {
            const saved = localStorage.getItem('truetunes_voted_artists');
            if (saved) {
                const data = JSON.parse(saved);
                votedArtists = new Map(Object.entries(data));
            }
        } catch (e) {
            console.error('[TrueTunes] Error loading voted artists:', e);
        }
    }

    function saveVotedArtists() {
        try {
            const data = Object.fromEntries(votedArtists);
            localStorage.setItem('truetunes_voted_artists', JSON.stringify(data));
        } catch (e) {
            console.error('[TrueTunes] Error saving voted artists:', e);
        }
    }

    // FIXED: Removed console.log from hasVoted to stop spam
    function hasVoted(artistId) {
        // ADMIN BYPASS: Allow voting even if already voted
        if (isAdmin() && ADMIN_BYPASS_DUPLICATE_CHECK) {
            // REMOVED: console.log spam
            return false; // Pretend they haven't voted
        }
        return votedArtists.has(artistId);
    }

    // ===== UTILITY: Calculate user's contribution to an artist's vote count =====
    function getUserVoteCountForArtist(artistId) {
        return userStats.votedArtists.filter(v => v.artistId === artistId && v.state === 'open').length;
    }

    // ===== TRUETUNES PANEL UI =====

    function createAccountTab() {
        if (!settings.githubLinked) {
            return `
            <div style="padding: 40px; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 16px;">🎵</div>
                <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 12px;">Connect Your GitHub Account</h2>
                <p style="color: #999; margin-bottom: 32px; max-width: 400px; margin-left: auto; margin-right: auto;">
                    Link your GitHub account to vote on AI-generated artists and help keep music authentic.
                </p>
                
                <button id="truetunes-github-login" style="background: linear-gradient(135deg, #7e22ce 0%, #db2777 100%); color: white; border: none; padding: 14px 36px; border-radius: 24px; font-size: 16px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(126, 34, 206, 0.4); transition: all 0.2s;">
                    <svg style="display: inline-block; vertical-align: middle; margin-right: 8px;" width="20" height="20" viewBox="0 0 16 16" fill="white">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    Login with GitHub
                </button>
                
                <p style="margin-top: 16px; font-size: 13px; color: #999;">
                    You'll enter a code on GitHub.com to authenticate
                </p>
            </div>
        `;
        }

        // Logged in - show profile + stats
        const totalFlagged = flaggedArtists.size;
        const MIN_VOTES = 10;

        // FIXED: Group votes by artist ID and calculate proper progress
        const votesByArtist = new Map();
        for (const vote of userStats.votedArtists) {
            if (!votesByArtist.has(vote.artistId)) {
                votesByArtist.set(vote.artistId, {
                    artistId: vote.artistId,
                    artistName: vote.artistName,
                    issues: [],
                    openIssues: [],
                    state: vote.state,
                    createdAt: vote.createdAt
                });
            }
            const artistData = votesByArtist.get(vote.artistId);
            artistData.issues.push(vote.issueNumber);
            if (vote.state === 'open') {
                artistData.openIssues.push(vote.issueNumber);
            }
        }

        // Get last 3 unique artists with aggregated progress
        // FIXED: Use user's open issue count + pending votes for accurate progress
        const recentVotes = Array.from(votesByArtist.values())
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 3)
            .map(vote => {
                const pending = window.trueTunesPending?.get(vote.artistId);
                const userOpenVotes = vote.openIssues.length;

                // Calculate total community votes (pending votes + user's contribution if not yet in pending)
                let totalVotes = pending ? pending.votes : userOpenVotes;

                return {
                    ...vote,
                    totalIssues: vote.issues.length,
                    userContribution: userOpenVotes,
                    progress: { current: totalVotes, needed: MIN_VOTES }
                };
            });

        return `
        <div style="padding: 24px; height: 100%; display: flex; flex-direction: column;">
            <!-- GitHub Profile Card -->
            <div style="display: flex; align-items: center; gap: 20px; background: linear-gradient(135deg, rgba(126, 34, 206, 0.2) 0%, rgba(219, 39, 119, 0.2) 100%); padding: 24px; border-radius: 16px; margin-bottom: 24px;">
                <img src="${settings.githubAvatar}" style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid #7e22ce;">
                <div style="flex: 1;">
                    <div style="font-size: 24px; font-weight: 700; margin-bottom: 4px;">${settings.githubUsername}</div>
                    <div style="color: #22c55e; font-weight: 600; margin-bottom: 8px;">
                        <svg style="display: inline-block; vertical-align: middle;" width="16" height="16" viewBox="0 0 16 16" fill="#22c55e">
                            <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                        </svg>
                        Account Connected
                    </div>
                    <button id="truetunes-logout" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px;">
                        Logout
                    </button>
                </div>
            </div>

            <!-- Stats Grid -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px;">
                <div style="background: rgba(126, 34, 206, 0.1); border: 1px solid rgba(126, 34, 206, 0.3); padding: 16px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #7e22ce;">${totalFlagged}</div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">Total Flagged</div>
                </div>
                <div style="background: rgba(219, 39, 119, 0.1); border: 1px solid rgba(219, 39, 119, 0.3); padding: 16px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #db2777;">${userStats.totalVotes}</div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">Your Votes</div>
                </div>
                <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); padding: 16px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #22c55e;">${Math.round((userStats.totalVotes / Math.max(totalFlagged, 1)) * 100)}%</div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">Contribution</div>
                </div>
            </div>

            <!-- Recent Activity - FIXED: No progress bar here, moved to Community tab -->
            <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 12px;">🔥 Recent Activity</h3>
            
            <div style="margin-bottom: 16px;">
                ${recentVotes.length > 0 ? recentVotes.map(vote => `
                    <a href="https://github.com/Lewdcifer666/TrueTunes/issues/${vote.issues[0]}" 
                       target="_blank"
                       style="display: block; background: rgba(255, 255, 255, 0.05); padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; text-decoration: none; color: white; transition: all 0.2s;"
                       onmouseover="this.style.background='rgba(255, 255, 255, 0.1)'"
                       onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${vote.artistName}</div>
                                <div style="font-size: 11px; color: #999;">
                                    <span style="color: ${vote.state === 'open' ? '#22c55e' : '#999'}; font-weight: 600;">${vote.totalIssues} issue${vote.totalIssues > 1 ? 's' : ''}</span>
                                    <span style="margin: 0 6px;">•</span>
                                    <span>${new Date(vote.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                </div>
                            </div>
                            <span style="background: ${vote.state === 'open' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)'}; color: ${vote.state === 'open' ? '#22c55e' : '#999'}; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap; margin-left: 12px;">
                                ${vote.state}
                            </span>
                        </div>
                    </a>
                `).join('') : '<div style="text-align: center; color: #999; padding: 40px;">No votes yet</div>'}
            </div>

            <!-- Last Verified -->
            ${userStats.lastVerified ? `
                <div style="padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; font-size: 12px; color: #999; text-align: center;">
                    Last verified: ${new Date(userStats.lastVerified).toLocaleString()}
                </div>
            ` : ''}
        </div>
    `;
    }

    function createCommunityTab() {
        if (!settings.githubLinked) {
            return `
            <div style="padding: 60px 40px; text-align: center; color: #999;">
                <div style="font-size: 48px; margin-bottom: 16px;">🌍</div>
                <p>Connect your GitHub account to view community activity</p>
            </div>
        `;
        }

        const formatTimeAgo = (dateString) => {
            const now = new Date();
            const past = new Date(dateString);
            const diffMs = now - past;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            return `${diffDays}d ago`;
        };

        const lastUpdatedText = communityFeed.lastUpdated
            ? `Updated ${formatTimeAgo(communityFeed.lastUpdated)}`
            : 'Never updated';

        const MIN_VOTES = 10;

        // ===== GROUP ACTIVITIES BY ARTIST =====
        const artistGroups = new Map();

        communityFeed.recentActivity.forEach(activity => {
            const normalizedId = activity.artistId?.replace(/^spotify:/, '');
            if (!normalizedId) return;

            if (!artistGroups.has(normalizedId)) {
                artistGroups.set(normalizedId, {
                    artistId: normalizedId,
                    artistName: activity.artistName,
                    platform: activity.platform,
                    reporters: [],
                    reporterAvatars: new Map(),
                    issueNumbers: activity.issueNumbers || [], // Get the full array
                    states: new Set(),
                    latestTime: activity.createdAt,
                    comments: 0
                });
            }

            const group = artistGroups.get(normalizedId);

            // Add reporter if not already added
            if (!group.reporters.includes(activity.reporter)) {
                group.reporters.push(activity.reporter);
                group.reporterAvatars.set(activity.reporter, activity.reporterAvatar);
            }
            // Don't push individual issue numbers - we already have the full array
            group.states.add(activity.state);
            group.comments += activity.comments;

            // Keep latest time
            if (new Date(activity.createdAt) > new Date(group.latestTime)) {
                group.latestTime = activity.createdAt;
            }
        });

        // Sort by latest activity
        const groupedActivities = Array.from(artistGroups.values())
            .sort((a, b) => new Date(b.latestTime) - new Date(a.latestTime));

        return `
        <div style="padding: 24px; display: flex; flex-direction: column; height: 100%;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-shrink: 0;">
                <h3 style="font-size: 18px; font-weight: 600;">🌍 Community Activity</h3>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="color: #999; font-size: 12px;">${lastUpdatedText}</span>
                    <button id="truetunes-refresh-community" style="background: rgba(126, 34, 206, 0.2); border: 1px solid #7e22ce; color: #7e22ce; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600;">
                        🔄 Refresh
                    </button>
                </div>
            </div>

            <!-- Stats Bar -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; flex-shrink: 0;">
                <div style="background: rgba(126, 34, 206, 0.1); border: 1px solid rgba(126, 34, 206, 0.3); padding: 12px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 20px; font-weight: 700; color: #7e22ce;">${communityFeed.recentActivity.length}</div>
                    <div style="font-size: 11px; color: #999; margin-top: 2px;">Total Reports</div>
                </div>
                <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); padding: 12px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 20px; font-weight: 700; color: #22c55e;">${groupedActivities.filter(g => g.states.has('open')).length}</div>
                    <div style="font-size: 11px; color: #999; margin-top: 2px;">Active Artists</div>
                </div>
                <div style="background: rgba(219, 39, 119, 0.1); border: 1px solid rgba(219, 39, 119, 0.3); padding: 12px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 20px; font-weight: 700; color: #db2777;">${new Set(communityFeed.recentActivity.map(a => a.reporter)).size}</div>
                    <div style="font-size: 11px; color: #999; margin-top: 2px;">Active Users</div>
                </div>
            </div>

            <!-- Grouped Activity Feed -->
            <div id="community-feed-container" style="flex: 1; overflow-y: auto; padding-right: 8px;">
                ${groupedActivities.length > 0 ? groupedActivities.slice(0, communityView.displayedCount).map(group => {
            // FIXED: Only count OPEN issues for vote progress
            const openIssues = communityFeed.recentActivity.filter(activity => {
                const normalizedId = activity.artistId?.replace(/^spotify:/, '');
                return normalizedId === group.artistId && activity.state === 'open';
            });
            const totalVotes = openIssues.length;
            const progressPercent = Math.min((totalVotes / MIN_VOTES) * 100, 100);
            const isOpen = group.states.has('open');
            const isFlagged = !isOpen && totalVotes >= MIN_VOTES;
            const issueLinks = group.issueNumbers.sort((a, b) => a - b).map(n =>
                `<a href="https://github.com/Lewdcifer666/TrueTunes/issues/${n}" 
                            target="_blank" 
                            style="color: #7e22ce; font-weight: 600; text-decoration: none;" 
                            onclick="event.stopPropagation();"
                            onmouseover="this.style.textDecoration='underline';"
                            onmouseout="this.style.textDecoration='none';">#${n}</a>`
            ).join(', ');

            return `
                    <div style="display: block; background: rgba(255, 255, 255, 0.05); padding: 14px; border-radius: 10px; margin-bottom: 10px; color: white; transition: all 0.2s; border-left: 3px solid ${isOpen ? '#22c55e' : (isFlagged ? '#ef4444' : '#666')};">
                        
                        <!-- Header Row with Reporters and Status -->
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                                ${group.reporters.slice(0, 3).map(reporter => `
                                    <img src="${group.reporterAvatars.get(reporter)}" 
                                         style="width: 24px; height: 24px; border-radius: 50%; border: 2px solid rgba(126, 34, 206, 0.5);"
                                         title="@${reporter}">
                                `).join('')}
                                ${group.reporters.length > 3 ? `
                                    <div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(126, 34, 206, 0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; border: 2px solid rgba(126, 34, 206, 0.5);">
                                        +${group.reporters.length - 3}
                                    </div>
                                ` : ''}
                            </div>
                            
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: 600; font-size: 12px; color: #7e22ce; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    ${group.reporters.map(r => `@${r}`).join(', ')}
                                </div>
                                <div style="font-size: 11px; color: #999;">reported ${formatTimeAgo(group.latestTime)}</div>
                            </div>
                            
                            <span style="background: ${isOpen ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)'}; border: 1px solid ${isOpen ? 'rgba(34, 197, 94, 0.4)' : 'rgba(100, 100, 100, 0.4)'}; color: ${isOpen ? '#22c55e' : '#999'}; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; flex-shrink: 0;">
                                ${isOpen ? 'open' : 'closed'}
                            </span>
                        </div>

                        <!-- Artist Name (Clickable) -->
                        <div style="margin-bottom: 6px;">
                            <a href="https://open.spotify.com/artist/${group.artistId}" 
                               target="_blank"
                               style="font-weight: 600; font-size: 15px; color: white; text-decoration: none; transition: color 0.2s; display: inline;"
                               onclick="event.stopPropagation();"
                               onmouseover="this.style.color='#7e22ce';"
                               onmouseout="this.style.color='white';">
                                ${group.artistName}
                            </a>
                        </div>
                        
                        <!-- Platform, Issues, and Vote Count -->
                        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; margin-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px; color: #999; overflow: hidden;">
                                <span style="flex-shrink: 0;">🎵 ${group.platform}</span>
                                <span style="flex-shrink: 0;">•</span>
                                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Issue ${issueLinks}</span>
                                ${group.comments > 0 ? `
                                    <span style="flex-shrink: 0;">•</span>
                                    <span style="flex-shrink: 0;">💬 ${group.comments}</span>
                                ` : ''}
                            </div>
                            
                            ${isOpen ? `
                                <span style="background: rgba(126, 34, 206, 0.2); border: 1px solid rgba(126, 34, 206, 0.4); color: #7e22ce; padding: 4px 12px; border-radius: 12px; font-weight: 700; white-space: nowrap; margin-left: 12px; flex-shrink: 0;">
                                    ${totalVotes}/${MIN_VOTES} Votes
                                </span>
                            ` : (isFlagged ? `
                                <span style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; padding: 4px 12px; border-radius: 12px; font-weight: 700; white-space: nowrap; margin-left: 12px; flex-shrink: 0;">
                                    Flagged
                                </span>
                            ` : '')}
                        </div>
                        
                        <!-- Progress Bar -->
                        ${isOpen ? `
                            <div style="width: 100%; height: 4px; background: rgba(126, 34, 206, 0.2); border-radius: 2px; overflow: hidden;">
                                <div style="height: 100%; background: linear-gradient(90deg, #7e22ce, #db2777); width: ${progressPercent}%; transition: width 0.3s ease;"></div>
                            </div>
                        ` : ''}
                    </div>
                `;
        }).join('') : `
                    <div style="text-align: center; color: #999; padding: 60px 20px;">
                        <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
                        <p>No community activity yet</p>
                        <button id="truetunes-fetch-community" style="margin-top: 16px; background: #7e22ce; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600;">
                            Load Activity
                        </button>
                    </div>
                `}
            ${groupedActivities.length > communityView.displayedCount ? `
                <div id="community-load-more" style="padding: 16px; text-align: center; color: #999; font-size: 12px;">
                    Scroll to load more (${groupedActivities.length - communityView.displayedCount} remaining)
                </div>
            ` : ''}
            </div>

            <!-- Auto-Update Notice -->
            <div style="margin-top: 16px; padding: 12px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; font-size: 11px; color: #60a5fa; text-align: center; flex-shrink: 0;">
                ⏱️ Auto-updates every 10 minutes
            </div>
        </div>
    `;
    }

    function updateCommunityFeedOnly() {
        const feedContainer = document.getElementById('community-feed-container');
        const loadMoreIndicator = document.getElementById('community-load-more');

        if (!feedContainer) return;

        // Temporarily disable scroll events during update
        communityView.isUpdating = true;

        // Save scroll position
        const savedScrollTop = feedContainer.scrollTop;

        // Group activities (same logic as createCommunityTab)
        const artistGroups = new Map();
        const MIN_VOTES = 10;

        communityFeed.recentActivity.forEach(activity => {
            const normalizedId = activity.artistId?.replace(/^spotify:/, '');
            if (!normalizedId) return;

            if (!artistGroups.has(normalizedId)) {
                artistGroups.set(normalizedId, {
                    artistId: normalizedId,
                    artistName: activity.artistName,
                    platform: activity.platform,
                    reporters: [],
                    reporterAvatars: new Map(),
                    issueNumbers: activity.issueNumbers || [], // Get the full array from the first activity
                    states: new Set(),
                    latestTime: activity.createdAt,
                    comments: 0
                });
            }

            const group = artistGroups.get(normalizedId);
            if (!group.reporters.includes(activity.reporter)) {
                group.reporters.push(activity.reporter);
                group.reporterAvatars.set(activity.reporter, activity.reporterAvatar);
            }
            // Don't push individual issue numbers - we already have the full array
            group.states.add(activity.state);
            group.comments += activity.comments;
            if (new Date(activity.createdAt) > new Date(group.latestTime)) {
                group.latestTime = activity.createdAt;
            }
        });

        const groupedActivities = Array.from(artistGroups.values())
            .sort((a, b) => new Date(b.latestTime) - new Date(a.latestTime));

        const formatTimeAgo = (dateString) => {
            const now = new Date();
            const past = new Date(dateString);
            const diffMs = now - past;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            if (diffMins < 1) return 'just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            return `${diffDays}d ago`;
        };

        // Build HTML for displayed items
        const displayedActivities = groupedActivities.slice(0, communityView.displayedCount);

        feedContainer.innerHTML = displayedActivities.length > 0 ? displayedActivities.map(group => {
            const openIssues = communityFeed.recentActivity.filter(activity => {
                const normalizedId = activity.artistId?.replace(/^spotify:/, '');
                return normalizedId === group.artistId && activity.state === 'open';
            });
            const totalVotes = openIssues.length;
            const progressPercent = Math.min((totalVotes / MIN_VOTES) * 100, 100);
            const isOpen = group.states.has('open');
            const isFlagged = !isOpen && totalVotes >= MIN_VOTES;
            const issueLinks = (group.issueNumbers && group.issueNumbers.length > 0)
                ? group.issueNumbers.filter(n => n !== null).sort((a, b) => a - b).map(n =>
                    `<a href="https://github.com/Lewdcifer666/TrueTunes/issues/${n}" 
            target="_blank" 
            style="color: #7e22ce; font-weight: 600; text-decoration: none;" 
            onclick="event.stopPropagation();"
            onmouseover="this.style.textDecoration='underline';"
            onmouseout="this.style.textDecoration='none';">#${n}</a>`
                ).join(', ')
                : '<span style="color: #999;">Community flagged</span>';

            return `
            <div style="display: block; background: rgba(255, 255, 255, 0.05); padding: 14px; border-radius: 10px; margin-bottom: 10px; color: white; transition: all 0.2s; border-left: 3px solid ${isOpen ? '#22c55e' : (isFlagged ? '#ef4444' : '#666')};">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                        ${group.reporters.slice(0, 3).map(reporter => `
                            <img src="${group.reporterAvatars.get(reporter)}" 
                                 style="width: 24px; height: 24px; border-radius: 50%; border: 2px solid rgba(126, 34, 206, 0.5);"
                                 title="@${reporter}">
                        `).join('')}
                        ${group.reporters.length > 3 ? `
                            <div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(126, 34, 206, 0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; border: 2px solid rgba(126, 34, 206, 0.5);">
                                +${group.reporters.length - 3}
                            </div>
                        ` : ''}
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 600; font-size: 12px; color: #7e22ce; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${group.reporters.map(r => `@${r}`).join(', ')}
                        </div>
                        <div style="font-size: 11px; color: #999;">reported ${formatTimeAgo(group.latestTime)}</div>
                    </div>
                    <span style="background: ${isOpen ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)'}; border: 1px solid ${isOpen ? 'rgba(34, 197, 94, 0.4)' : 'rgba(100, 100, 100, 0.4)'}; color: ${isOpen ? '#22c55e' : '#999'}; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; flex-shrink: 0;">
                        ${isOpen ? 'open' : 'closed'}
                    </span>
                </div>
                <div style="margin-bottom: 6px;">
                    <a href="https://open.spotify.com/artist/${group.artistId}" 
                       target="_blank"
                       style="font-weight: 600; font-size: 15px; color: white; text-decoration: none; transition: color 0.2s; display: inline;"
                       onclick="event.stopPropagation();"
                       onmouseover="this.style.color='#7e22ce';"
                       onmouseout="this.style.color='white';">
                        ${group.artistName}
                    </a>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; color: #999; overflow: hidden;">
                        <span style="flex-shrink: 0;">🎵 ${group.platform}</span>
                        <span style="flex-shrink: 0;">•</span>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Issue ${issueLinks}</span>
                        ${group.comments > 0 ? `
                            <span style="flex-shrink: 0;">•</span>
                            <span style="flex-shrink: 0;">💬 ${group.comments}</span>
                        ` : ''}
                    </div>
                    ${isOpen ? `
                        <span style="background: rgba(126, 34, 206, 0.2); border: 1px solid rgba(126, 34, 206, 0.4); color: #7e22ce; padding: 4px 12px; border-radius: 12px; font-weight: 700; white-space: nowrap; margin-left: 12px; flex-shrink: 0;">
                            ${totalVotes}/${MIN_VOTES} Votes
                        </span>
                    ` : (isFlagged ? `
                        <span style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; padding: 4px 12px; border-radius: 12px; font-weight: 700; white-space: nowrap; margin-left: 12px; flex-shrink: 0;">
                            Flagged
                        </span>
                    ` : '')}
                </div>
                ${isOpen ? `
                    <div style="width: 100%; height: 4px; background: rgba(126, 34, 206, 0.2); border-radius: 2px; overflow: hidden;">
                        <div style="height: 100%; background: linear-gradient(90deg, #7e22ce, #db2777); width: ${progressPercent}%; transition: width 0.3s ease;"></div>
                    </div>
                ` : ''}
            </div>
        `;
        }).join('') : `
        <div style="text-align: center; color: #999; padding: 60px 20px;">
            <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
            <p>No community activity yet</p>
        </div>
    `;

        // Update or remove the "load more" indicator
        if (loadMoreIndicator) {
            if (groupedActivities.length > communityView.displayedCount) {
                loadMoreIndicator.textContent = `Scroll to load more (${groupedActivities.length - communityView.displayedCount} remaining)`;
                loadMoreIndicator.style.display = 'block';
            } else {
                loadMoreIndicator.style.display = 'none';
            }
        }

        // Restore scroll position using requestAnimationFrame for smooth restoration
        requestAnimationFrame(() => {
            feedContainer.scrollTop = savedScrollTop;
            // Re-enable scroll events after restoration
            requestAnimationFrame(() => {
                communityView.isUpdating = false;
            });
        });
    }

    function createStatsTab() {
        if (!settings.githubLinked) {
            return `
            <div style="padding: 60px 40px; text-align: center; color: #999;">
                <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
                <p>Connect your GitHub account to view statistics</p>
            </div>
        `;
        }

        const totalFlagged = flaggedArtists.size;

        const recentVotes = userStats.votedArtists.slice(0, 5);

        return `
        <div style="padding: 24px; display: flex; flex-direction: column; height: 100%;">
            <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 20px;">📊 Community Statistics</h3>
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px;">
                <div style="background: rgba(126, 34, 206, 0.1); border: 1px solid rgba(126, 34, 206, 0.3); padding: 16px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #7e22ce;">${totalFlagged}</div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">Total Flagged</div>
                </div>
                <div style="background: rgba(219, 39, 119, 0.1); border: 1px solid rgba(219, 39, 119, 0.3); padding: 16px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #db2777;">${userStats.totalVotes}</div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">Your Votes</div>
                </div>
                <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); padding: 16px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 28px; font-weight: 700; color: #22c55e;">${Math.round((userStats.totalVotes / Math.max(totalFlagged, 1)) * 100)}%</div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">Contribution</div>
                </div>
            </div>

            <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px;">🔥 Recent Activity</h3>
            
            <div style="height: 300px; overflow-y: auto; padding-right: 8px;">
                ${recentVotes.length > 0 ? recentVotes.map(vote => `
                    <a href="https://github.com/Lewdcifer666/TrueTunes/issues/${vote.issueNumber}" 
                       target="_blank"
                       style="display: block; background: rgba(255, 255, 255, 0.05); padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; text-decoration: none; color: white; transition: all 0.2s;"
                       onmouseover="this.style.background='rgba(255, 255, 255, 0.1)'"
                       onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${vote.artistName}</div>
                                <div style="font-size: 11px; color: #999;">
                                    <span style="color: ${vote.state === 'open' ? '#22c55e' : '#999'}; font-weight: 600;">Issue #${vote.issueNumber}</span>
                                    <span style="margin: 0 6px;">•</span>
                                    <span>${new Date(vote.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                </div>
                            </div>
                            <span style="background: ${vote.state === 'open' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)'}; color: ${vote.state === 'open' ? '#22c55e' : '#999'}; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap; margin-left: 12px;">
                                ${vote.state}
                            </span>
                        </div>
                    </a>
                `).join('') : '<div style="text-align: center; color: #999; padding: 40px;">No votes yet</div>'}
            </div>
        </div>
    `;
    }

    function createFlaggedTab() {
        const totalFlagged = flaggedArtists.size;
        const flaggedArray = Array.from(flaggedArtists.values())
            .sort((a, b) => new Date(b.added) - new Date(a.added));

        return `
        <div style="padding: 24px; display: flex; flex-direction: column; height: 100%;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-shrink: 0;">
                <h3 style="font-size: 18px; font-weight: 600;">🚩 Flagged Artists</h3>
                <span style="background: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 6px 12px; border-radius: 12px; font-size: 13px; font-weight: 700;">
                    ${totalFlagged} Total
                </span>
            </div>

            <!-- Search Bar -->
            <div style="margin-bottom: 20px; flex-shrink: 0;">
                <input 
                    type="text" 
                    id="flagged-search-input"
                    placeholder="Search flagged artists..."
                    style="width: 100%; padding: 12px 16px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; color: white; font-size: 14px; outline: none; transition: all 0.2s;"
                    onfocus="this.style.borderColor='#7e22ce'; this.style.background='rgba(126, 34, 206, 0.1)';"
                    onblur="this.style.borderColor='rgba(255, 255, 255, 0.2)'; this.style.background='rgba(255, 255, 255, 0.1)';"
                >
            </div>

            <!-- Results Container -->
            <div id="flagged-artists-list" style="flex: 1; overflow-y: auto; padding-right: 8px;">
                ${flaggedArray.length > 0 ? flaggedArray.map(artist => `
                    <div class="flagged-artist-item" data-artist-id="${artist.platforms.spotify}" style="background: rgba(255, 255, 255, 0.05); padding: 14px; border-radius: 10px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; border-left: 3px solid #ef4444;"
                         onmouseover="this.style.background='rgba(255, 255, 255, 0.1)'; this.style.transform='translateX(4px)';"
                         onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'; this.style.transform='translateX(0)';">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    ${artist.name}
                                </div>
                                <div style="font-size: 11px; color: #999;">
                                    <span style="color: #ef4444; font-weight: 600;">${artist.votes} votes</span>
                                    <span style="margin: 0 6px;">•</span>
                                    <span>Flagged ${new Date(artist.added).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                </div>
                            </div>
                            <div style="margin-left: 12px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M9 18l6-6-6-6"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                `).join('') : `
                    <div style="text-align: center; color: #999; padding: 60px 20px;">
                        <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                        <p>No artists found</p>
                    </div>
                `}
            </div>
        </div>
    `;
    }

    function createHistoryTab() {
        if (!settings.githubLinked) {
            return `
            <div style="padding: 60px 40px; text-align: center; color: #999;">
                <div style="font-size: 48px; margin-bottom: 16px;">📜</div>
                <p>Connect your GitHub account to view your voting history</p>
            </div>
        `;
        }

        const openIssues = userStats.votedArtists.filter(v => v.state === 'open')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const closedIssues = userStats.votedArtists.filter(v => v.state === 'closed')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const viewLabels = {
            'open-only': '🟢 Open Only',
            'closed-only': '⚫ Closed Only',
            'side-by-side': '📊 Side-by-Side',
            'combined': '📋 Combined'
        };

        let contentHTML = '';

        if (historyView.mode === 'open-only') {
            const displayedIssues = openIssues.slice(0, historyView.displayedCount);
            contentHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                    <div style="flex: 1; background: rgba(34, 197, 94, 0.05); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; margin-bottom: 12px;">
                        <div style="flex: 1; overflow-y: auto; min-height: 0;">
                            ${displayedIssues.length > 0 ? displayedIssues.map((vote, index) => renderCompactHistoryItem(vote, 'open', index === displayedIssues.length - 1)).join('') : '<div style="text-align: center; color: #666; padding: 40px; font-size: 13px;">No open issues</div>'}
                        </div>
                    </div>
                    ${openIssues.length > historyView.displayedCount ? `
                        <button id="load-more-history" style="width: 100%; padding: 12px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); color: #22c55e; border-radius: 8px; cursor: pointer; font-weight: 600; flex-shrink: 0;">
                            Load More (${openIssues.length - historyView.displayedCount} remaining)
                        </button>
                    ` : ''}
                </div>
            `;
        } else if (historyView.mode === 'closed-only') {
            const displayedIssues = closedIssues.slice(0, historyView.displayedCount);
            contentHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                    <div style="flex: 1; background: rgba(100, 100, 100, 0.05); border: 1px solid rgba(100, 100, 100, 0.2); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; margin-bottom: 12px;">
                        <div style="flex: 1; overflow-y: auto; min-height: 0;">
                            ${displayedIssues.length > 0 ? displayedIssues.map((vote, index) => renderCompactHistoryItem(vote, 'closed', index === displayedIssues.length - 1)).join('') : '<div style="text-align: center; color: #666; padding: 40px; font-size: 13px;">No closed issues</div>'}
                        </div>
                    </div>
                    ${closedIssues.length > historyView.displayedCount ? `
                        <button id="load-more-history" style="width: 100%; padding: 12px; background: rgba(100, 100, 100, 0.1); border: 1px solid rgba(100, 100, 100, 0.3); color: #999; border-radius: 8px; cursor: pointer; font-weight: 600; flex-shrink: 0;">
                            Load More (${closedIssues.length - historyView.displayedCount} remaining)
                        </button>
                    ` : ''}
                </div>
            `;
        } else if (historyView.mode === 'side-by-side') {
            contentHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; height: 100%; margin-bottom: 12px;">
                    <div style="display: flex; flex-direction: column; background: rgba(34, 197, 94, 0.05); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 12px; overflow: hidden; min-height: 0;">
                        <div style="padding: 12px 16px; background: rgba(34, 197, 94, 0.1); border-bottom: 1px solid rgba(34, 197, 94, 0.2); flex-shrink: 0;">
                            <div style="font-weight: 600; font-size: 14px; color: #22c55e; display: flex; align-items: center; gap: 8px;">
                                <div style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e;"></div>
                                Open Issues (${openIssues.length})
                            </div>
                        </div>
                        <div style="flex: 1; overflow-y: auto; min-height: 0;">
                            ${openIssues.length > 0 ? openIssues.map((vote, index) => renderCompactHistoryItem(vote, 'open', index === openIssues.length - 1)).join('') : '<div style="text-align: center; color: #666; padding: 40px 12px; font-size: 13px;">No open issues</div>'}
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; background: rgba(100, 100, 100, 0.05); border: 1px solid rgba(100, 100, 100, 0.2); border-radius: 12px; overflow: hidden; min-height: 0;">
                        <div style="padding: 12px 16px; background: rgba(100, 100, 100, 0.1); border-bottom: 1px solid rgba(100, 100, 100, 0.2); flex-shrink: 0;">
                            <div style="font-weight: 600; font-size: 14px; color: #999; display: flex; align-items: center; gap: 8px;">
                                <div style="width: 8px; height: 8px; border-radius: 50%; background: #666;"></div>
                                Closed Issues (${closedIssues.length})
                            </div>
                        </div>
                        <div style="flex: 1; overflow-y: auto; min-height: 0;">
                            ${closedIssues.length > 0 ? closedIssues.map((vote, index) => renderCompactHistoryItem(vote, 'closed', index === closedIssues.length - 1)).join('') : '<div style="text-align: center; color: #666; padding: 40px 12px; font-size: 13px;">No closed issues</div>'}
                        </div>
                    </div>
                </div>
            `;
        } else if (historyView.mode === 'combined') {
            const allIssues = [...userStats.votedArtists].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const displayedIssues = allIssues.slice(0, historyView.displayedCount);
            contentHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                    <div style="flex: 1; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; margin-bottom: 12px;">
                        <div style="flex: 1; overflow-y: auto; min-height: 0;">
                            ${displayedIssues.length > 0 ? displayedIssues.map((vote, index) => renderCompactHistoryItem(vote, vote.state, index === displayedIssues.length - 1)).join('') : '<div style="text-align: center; color: #666; padding: 40px; font-size: 13px;">No issues</div>'}
                        </div>
                    </div>
                    ${allIssues.length > historyView.displayedCount ? `
                        <button id="load-more-history" style="width: 100%; padding: 12px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: #3b82f6; border-radius: 8px; cursor: pointer; font-weight: 600; flex-shrink: 0;">
                            Load More (${allIssues.length - historyView.displayedCount} remaining)
                        </button>
                    ` : ''}
                </div>
            `;
        }

        return `
        <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden;">
            <div style="padding: 24px 24px 0 24px; flex-shrink: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h3 style="font-size: 18px; font-weight: 600;">📜 Voting History</h3>
                        <button id="toggle-history-view" style="padding: 6px 12px; background: rgba(126, 34, 206, 0.2); border: 1px solid #7e22ce; color: #7e22ce; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">
                            ${viewLabels[historyView.mode]}
                        </button>
                    </div>
                    <span style="color: #999; font-size: 14px;">${userStats.votedArtists.length} total votes</span>
                </div>
            </div>
            
            <div id="history-content-area" style="flex: 1; display: flex; flex-direction: column; overflow-y: hidden; overflow-x: hidden; min-height: 0; padding: 0 24px 24px 24px;">
                ${contentHTML}
            </div>
        </div>
    `;
    }

    function renderCompactHistoryItem(vote, state, isLast) {
        // Calculate vote progress for open issues only
        let voteProgressHTML = '';
        if (state === 'open') {
            let totalVotes = 1; // Minimum: user's own vote

            // PRIORITY 1: Check pending.json (most accurate)
            const pending = window.trueTunesPending?.get(vote.artistId);
            if (pending) {
                totalVotes = pending.votes;
            } else {
                // PRIORITY 2: Check community feed for real-time count
                const communityActivities = communityFeed.recentActivity.filter(activity => {
                    const normalizedId = activity.artistId?.replace(/^spotify:/, '');
                    return normalizedId === vote.artistId && activity.state === 'open';
                });

                if (communityActivities.length > 0) {
                    // Count unique reporters across all open issues for this artist
                    const uniqueReporters = new Set();
                    communityActivities.forEach(activity => {
                        uniqueReporters.add(activity.reporter);
                    });
                    totalVotes = uniqueReporters.size;
                }
            }

            const MIN_VOTES = 10;
            voteProgressHTML = `
            <span style="margin: 0 6px;">•</span>
            <span style="color: #7e22ce; font-weight: 600;">${totalVotes}/${MIN_VOTES} votes</span>
        `;
        }

        return `
        <a href="https://github.com/Lewdcifer666/TrueTunes/issues/${vote.issueNumber}" 
           target="_blank"
           style="display: block; padding: 12px 16px; text-decoration: none; color: white; transition: all 0.2s; ${!isLast ? 'border-bottom: 1px solid rgba(255, 255, 255, 0.1);' : ''}"
           onmouseover="this.style.background='rgba(255, 255, 255, 0.05)';"
           onmouseout="this.style.background='transparent';">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1; min-width: 0; margin-right: 12px;">
                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${vote.artistName}</div>
                    <div style="font-size: 11px; color: #999;">
                        <span style="color: ${state === 'open' ? '#22c55e' : '#999'}; font-weight: 600;">Issue #${vote.issueNumber}</span>
                        <span style="margin: 0 6px;">•</span>
                        <span>${new Date(vote.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        ${voteProgressHTML}
                    </div>
                </div>
                <span style="background: ${state === 'open' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)'}; color: ${state === 'open' ? '#22c55e' : '#999'}; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; white-space: nowrap;">
                    ${state}
                </span>
            </div>
        </a>
    `;
    }

    function createSettingsTab() {
        return `
        <div style="padding: 24px;">
            <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 20px;">⚙️ Detection Settings</h3>
            
            <label style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(255, 255, 255, 0.05); border-radius: 10px; margin-bottom: 12px; cursor: pointer;">
                <input type="checkbox" id="truetunes-setting-warnings" ${settings.showWarnings ? 'checked' : ''} 
                       style="width: 20px; height: 20px; cursor: pointer; accent-color: #7e22ce;">
                <div>
                    <div style="font-weight: 600; margin-bottom: 4px;">Show Notifications</div>
                    <div style="font-size: 12px; color: #999;">Display warning when AI-generated music is detected</div>
                </div>
            </label>

            <label style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(255, 255, 255, 0.05); border-radius: 10px; margin-bottom: 12px; cursor: pointer;">
                <input type="checkbox" id="truetunes-setting-highlight" ${settings.highlightInPlaylists ? 'checked' : ''} 
                       style="width: 20px; height: 20px; cursor: pointer; accent-color: #7e22ce;">
                <div>
                    <div style="font-weight: 600; margin-bottom: 4px;">Highlight in Playlists</div>
                    <div style="font-size: 12px; color: #999;">Show red indicators on flagged artists in playlists</div>
                </div>
            </label>

            <label style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(255, 255, 255, 0.05); border-radius: 10px; margin-bottom: 12px; cursor: pointer;">
                <input type="checkbox" id="truetunes-setting-skip" ${settings.autoSkip ? 'checked' : ''} 
                       style="width: 20px; height: 20px; cursor: pointer; accent-color: #7e22ce;">
                <div>
                    <div style="font-weight: 600; margin-bottom: 4px;">Auto-Skip Tracks</div>
                    <div style="font-size: 12px; color: #999;">Automatically skip AI-generated tracks</div>
                </div>
            </label>

            <label style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(255, 200, 0, 0.05); border: 1px solid rgba(255, 200, 0, 0.2); border-radius: 10px; margin-bottom: 12px; cursor: pointer;">
                <input type="checkbox" id="truetunes-setting-hide" ${settings.autoHide ? 'checked' : ''} 
                       style="width: 20px; height: 20px; cursor: pointer; accent-color: #f59e0b;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                        Auto-Hide Songs
                        <span style="background: rgba(255, 200, 0, 0.2); color: #f59e0b; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700;">SAFER</span>
                    </div>
                    <div style="font-size: 12px; color: #999;">Hide AI tracks from your playlists (non-destructive)</div>
                </div>
            </label>

            <label style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px; margin-bottom: 24px; cursor: pointer;">
                <input type="checkbox" id="truetunes-setting-remove" ${settings.autoDislike ? 'checked' : ''} 
                       style="width: 20px; height: 20px; cursor: pointer; accent-color: #ef4444;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                        Auto-Remove from Library
                        <span style="background: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700;">DANGER</span>
                    </div>
                    <div style="font-size: 12px; color: #999; margin-bottom: 8px;">Automatically remove AI tracks from your library</div>
                    <div style="font-size: 11px; color: #ef4444; background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 6px; line-height: 1.4;">
                        ⚠️ <strong>Warning:</strong> This will permanently remove songs. TrueTunes is not responsible for any loss of music. Use at your own risk.
                    </div>
                </div>
            </label>

            <div style="padding: 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 10px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-weight: 600;">Verification Interval</span>
                    <span style="color: #999;">Every 30 seconds</span>
                </div>
                <button id="truetunes-verify-now" style="width: 100%; background: #3b82f6; color: white; border: none; padding: 10px; border-radius: 8px; cursor: pointer; font-weight: 600; margin-top: 8px;">
                    Verify Votes Now
                </button>
            </div>
        </div>
    `;
    }

    function renderTrueTunesPanel() {
        const panel = document.getElementById('truetunes-panel-content');
        if (!panel) return;

        // Save scroll position for community tab
        let savedScrollTop = 0;
        if (currentTab === 'community') {
            const feedContainer = document.getElementById('community-feed-container');
            if (feedContainer) {
                savedScrollTop = feedContainer.scrollTop;
            }
        }

        const tabs = {
            account: createAccountTab(),
            community: createCommunityTab(),
            flagged: createFlaggedTab(),
            history: createHistoryTab(),
            settings: createSettingsTab()
        };

        if (currentTab === 'history') {
            const historyContent = document.getElementById('history-content-area');
            if (historyContent) {
                historyContent.style.opacity = '0';

                setTimeout(() => {
                    panel.innerHTML = tabs[currentTab];
                    const newContent = document.getElementById('history-content-area');
                    if (newContent) {
                        newContent.offsetHeight;
                        newContent.style.opacity = '1';
                    }
                    attachTabEventListeners();
                }, 150);
                return;
            }
        }

        panel.style.opacity = '0';
        panel.style.transition = 'opacity 0.15s ease';

        setTimeout(() => {
            panel.innerHTML = tabs[currentTab];
            panel.style.opacity = '1';

            // Restore scroll position for community tab
            if (currentTab === 'community' && savedScrollTop > 0) {
                setTimeout(() => {
                    const feedContainer = document.getElementById('community-feed-container');
                    if (feedContainer) {
                        feedContainer.scrollTop = savedScrollTop;
                    }
                }, 0);
            }

            attachTabEventListeners();
        }, 150);
    }

    function attachFlaggedArtistClicks() {
        const artistItems = document.querySelectorAll('.flagged-artist-item');
        artistItems.forEach(item => {
            item.addEventListener('click', () => {
                const artistId = item.dataset.artistId;
                if (artistId) {
                    // Close the modal
                    const modal = document.getElementById('truetunes-modal');
                    if (modal) modal.remove();

                    // Navigate to artist page
                    Spicetify.Platform.History.push(`/artist/${artistId}`);
                }
            });
        });
    }

    function attachTabEventListeners() {
        if (currentTab === 'account') {
            document.getElementById('truetunes-github-login')?.addEventListener('click', startGithubDeviceFlow);

            document.getElementById('truetunes-logout')?.addEventListener('click', () => {
                if (confirm('Are you sure you want to logout?')) {
                    logoutGithub();
                }
            });
        } else if (currentTab === 'community') {
            document.getElementById('truetunes-refresh-community')?.addEventListener('click', async () => {
                const btn = document.getElementById('truetunes-refresh-community');
                const feedContainer = document.getElementById('community-feed-container');
                const savedScrollTop = feedContainer ? feedContainer.scrollTop : 0;
                const savedDisplayCount = communityView.displayedCount;

                if (btn) {
                    btn.textContent = '⏳ Refreshing...';
                    btn.disabled = true;
                }

                communityView.isUpdating = true;
                await fetchCommunityActivity();

                // Only reset if near top, otherwise preserve
                if (savedScrollTop < 500) {
                    communityView.displayedCount = 10;
                } else {
                    communityView.displayedCount = savedDisplayCount;
                }

                updateCommunityFeedOnly();
                communityView.isUpdating = false;

                if (btn) {
                    btn.textContent = '🔄 Refresh';
                    btn.disabled = false;
                }
                Spicetify.showNotification('✓ Community feed refreshed', false, 2000);
            });

            document.getElementById('truetunes-fetch-community')?.addEventListener('click', async () => {
                await fetchCommunityActivity();
            });

            // Lazy loading scroll handler with debugging
            const feedContainer = document.getElementById('community-feed-container');
            if (feedContainer) {
                console.log('[TrueTunes Community] Attached scroll listener');

                feedContainer.addEventListener('scroll', () => {
                    // Skip if currently updating
                    if (communityView.isUpdating) return;

                    const { scrollTop, scrollHeight, clientHeight } = feedContainer;

                    console.log('[TrueTunes Community] Scroll event:', {
                        scrollTop,
                        scrollHeight,
                        clientHeight,
                        threshold: scrollHeight * 0.8,
                        shouldLoad: scrollTop + clientHeight >= scrollHeight * 0.8
                    });

                    // Load more when scrolled 80% down
                    if (scrollTop + clientHeight >= scrollHeight * 0.8) {
                        const artistGroups = new Map();

                        communityFeed.recentActivity.forEach(activity => {
                            const normalizedId = activity.artistId?.replace(/^spotify:/, '');
                            if (!normalizedId) return;

                            if (!artistGroups.has(normalizedId)) {
                                artistGroups.set(normalizedId, { latestTime: activity.createdAt });
                            }
                        });

                        const totalGroups = artistGroups.size;

                        console.log('[TrueTunes Community] Lazy load check:', {
                            displayed: communityView.displayedCount,
                            total: totalGroups,
                            shouldLoadMore: communityView.displayedCount < totalGroups
                        });

                        if (communityView.displayedCount < totalGroups) {
                            console.log('[TrueTunes Community] Loading more items...');
                            communityView.displayedCount += communityView.loadMoreStep;
                            updateCommunityFeedOnly();
                        }
                    }
                });

                // CRITICAL: Check if container is actually scrollable
                setTimeout(() => {
                    const { scrollHeight, clientHeight } = feedContainer;
                    console.log('[TrueTunes Community] Container check:', {
                        scrollHeight,
                        clientHeight,
                        isScrollable: scrollHeight > clientHeight,
                        totalActivities: communityFeed.recentActivity.length
                    });

                    // If content doesn't fill container, try loading more automatically
                    if (scrollHeight <= clientHeight && communityView.displayedCount < communityFeed.recentActivity.length) {
                        console.log('[TrueTunes Community] Auto-loading more (content too short)');
                        communityView.displayedCount = Math.min(
                            communityView.displayedCount + communityView.loadMoreStep,
                            communityFeed.recentActivity.length
                        );
                        updateCommunityFeedOnly();
                    }
                }, 100);
            }

        } else if (currentTab === 'settings') {
            document.getElementById('truetunes-setting-warnings')?.addEventListener('change', (e) => {
                settings.showWarnings = e.target.checked;
                saveSettings();
            });

            document.getElementById('truetunes-setting-highlight')?.addEventListener('change', (e) => {
                settings.highlightInPlaylists = e.target.checked;
                saveSettings();
                highlightPlaylistItems();
            });

            document.getElementById('truetunes-setting-skip')?.addEventListener('change', (e) => {
                settings.autoSkip = e.target.checked;
                saveSettings();

                // Update the now playing bar toggle button
                updateSkipToggleContent();
            });

            document.getElementById('truetunes-setting-hide')?.addEventListener('change', (e) => {
                settings.autoHide = e.target.checked;
                saveSettings();
                if (e.target.checked) {
                    Spicetify.showNotification('✓ Auto-hide enabled for AI tracks', false, 2000);
                }
            });

            document.getElementById('truetunes-setting-remove')?.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const confirmed = confirm(
                        '⚠️ WARNING: This will automatically remove AI-generated tracks from your library.\n\n' +
                        'This action is permanent and cannot be undone.\n\n' +
                        'TrueTunes is not responsible for any loss of music.\n\n' +
                        'Are you sure you want to enable this feature?'
                    );

                    if (confirmed) {
                        settings.autoDislike = true;
                        saveSettings();
                        Spicetify.showNotification('⚠️ Auto-remove enabled - use with caution', true, 3000);
                    } else {
                        e.target.checked = false;
                    }
                } else {
                    settings.autoDislike = false;
                    saveSettings();
                }
            });

            document.getElementById('truetunes-verify-now')?.addEventListener('click', async () => {
                Spicetify.showNotification('Verifying votes...', false, 2000);
                await verifyRecentVotes();
                renderTrueTunesPanel();
            });
        } else if (currentTab === 'flagged') {
            // Search functionality
            const searchInput = document.getElementById('flagged-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const query = e.target.value.toLowerCase().trim();
                    const listContainer = document.getElementById('flagged-artists-list');

                    if (!query) {
                        // Show all
                        const allArtists = Array.from(flaggedArtists.values())
                            .sort((a, b) => new Date(b.added) - new Date(a.added));

                        listContainer.innerHTML = allArtists.map(artist => `
                            <div class="flagged-artist-item" data-artist-id="${artist.platforms.spotify}" style="background: rgba(255, 255, 255, 0.05); padding: 14px; border-radius: 10px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; border-left: 3px solid #ef4444;"
                                 onmouseover="this.style.background='rgba(255, 255, 255, 0.1)'; this.style.transform='translateX(4px)';"
                                 onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'; this.style.transform='translateX(0)';">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                            ${artist.name}
                                        </div>
                                        <div style="font-size: 11px; color: #999;">
                                            <span style="color: #ef4444; font-weight: 600;">${artist.votes} votes</span>
                                            <span style="margin: 0 6px;">•</span>
                                            <span>Flagged ${new Date(artist.added).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                        </div>
                                    </div>
                                    <div style="margin-left: 12px;">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M9 18l6-6-6-6"/>
                                        </svg>
                                    </div>
                                </div>
                            </div>
                        `).join('');
                        attachFlaggedArtistClicks();
                        return;
                    }

                    // Filter results
                    const filtered = Array.from(flaggedArtists.values())
                        .filter(a => a.name.toLowerCase().includes(query))
                        .sort((a, b) => new Date(b.added) - new Date(a.added));

                    if (filtered.length > 0) {
                        listContainer.innerHTML = filtered.map(artist => `
                            <div class="flagged-artist-item" data-artist-id="${artist.platforms.spotify}" style="background: rgba(255, 255, 255, 0.05); padding: 14px; border-radius: 10px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; border-left: 3px solid #ef4444;"
                                 onmouseover="this.style.background='rgba(255, 255, 255, 0.1)'; this.style.transform='translateX(4px)';"
                                 onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'; this.style.transform='translateX(0)';">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                            ${artist.name}
                                        </div>
                                        <div style="font-size: 11px; color: #999;">
                                            <span style="color: #ef4444; font-weight: 600;">${artist.votes} votes</span>
                                            <span style="margin: 0 6px;">•</span>
                                            <span>Flagged ${new Date(artist.added).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                        </div>
                                    </div>
                                    <div style="margin-left: 12px;">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M9 18l6-6-6-6"/>
                                        </svg>
                                    </div>
                                </div>
                            </div>
                        `).join('');
                    } else {
                        listContainer.innerHTML = `
                            <div style="text-align: center; color: #999; padding: 60px 20px;">
                                <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                                <p>No artists found matching "${query}"</p>
                            </div>
                        `;
                    }
                    attachFlaggedArtistClicks();
                });
            }

            // Attach click handlers
            attachFlaggedArtistClicks();
        } else if (currentTab === 'history') {
            const toggleBtn = document.getElementById('toggle-history-view');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    const modes = ['open-only', 'closed-only', 'side-by-side', 'combined'];
                    const currentIndex = modes.indexOf(historyView.mode);
                    const nextIndex = (currentIndex + 1) % modes.length;
                    historyView.mode = modes[nextIndex];
                    historyView.displayedCount = 20;
                    saveSettings();

                    const contentArea = document.getElementById('history-content-area');
                    if (contentArea) {
                        contentArea.style.opacity = '0';
                        setTimeout(() => {
                            renderTrueTunesPanel();
                        }, 150);
                    } else {
                        renderTrueTunesPanel();
                    }
                });

                toggleBtn.addEventListener('mouseenter', () => {
                    toggleBtn.style.background = 'rgba(126, 34, 206, 0.3)';
                    toggleBtn.style.transform = 'scale(1.05)';
                });

                toggleBtn.addEventListener('mouseleave', () => {
                    toggleBtn.style.background = 'rgba(126, 34, 206, 0.2)';
                    toggleBtn.style.transform = 'scale(1)';
                });
            }

            document.getElementById('load-more-history')?.addEventListener('click', () => {
                historyView.displayedCount += historyView.loadMoreStep;
                renderTrueTunesPanel();
            });
        }
    }

    function showTrueTunesPanel() {
        let modal = document.getElementById('truetunes-modal');

        if (modal) {
            updateTrueTunesPanelContent();
            return;
        }

        modal = document.createElement('div');
        modal.id = 'truetunes-modal';
        modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(10px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.2s ease;
    `;

        const panel = document.createElement('div');
        panel.id = 'truetunes-panel';
        panel.style.cssText = `
        background: #121212;
        width: 750px;
        max-width: 90vw;
        height: 820px;
        max-height: 90vh;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        animation: slideUp 0.3s ease;
        overflow: hidden;
    `;

        const header = document.createElement('div');
        header.style.cssText = `
        background: linear-gradient(135deg, #7e22ce 0%, #db2777 100%);
        padding: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;

        header.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="white">
                <path d="M16 2C8.3 2 2 8.3 2 16s6.3 14 14 14 14-6.3 14-14S23.7 2 16 2zm0 4c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zM8 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm8 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0-8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm8 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
            </svg>
            <h2 style="font-size: 22px; font-weight: 700; color: white;">TrueTunes</h2>
        </div>
        <button id="truetunes-close" style="background: rgba(255, 255, 255, 0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 20px;">
            ✕
        </button>
    `;

        const tabNav = document.createElement('div');
        tabNav.id = 'truetunes-tab-nav';
        tabNav.style.cssText = `
        display: flex;
        background: #1a1a1a;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    `;

        const tabs = [
            { id: 'account', icon: '👤', label: 'Account' },
            { id: 'community', icon: '🌍', label: 'Community' },
            { id: 'flagged', icon: '🚩', label: 'Flagged' },
            { id: 'history', icon: '📜', label: 'History' },
            { id: 'settings', icon: '⚙️', label: 'Settings' }
        ];

        tabs.forEach(tab => {
            const button = document.createElement('button');
            button.className = 'truetunes-tab';
            button.dataset.tab = tab.id;
            button.style.cssText = `
            flex: 1;
            padding: 16px;
            background: ${currentTab === tab.id ? 'rgba(126, 34, 206, 0.2)' : 'transparent'};
            border: none;
            color: ${currentTab === tab.id ? '#7e22ce' : '#999'};
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            border-bottom: 2px solid ${currentTab === tab.id ? '#7e22ce' : 'transparent'};
            transition: all 0.2s;
        `;
            button.innerHTML = `${tab.icon} ${tab.label}`;

            button.addEventListener('click', () => {
                currentTab = tab.id;
                updateTrueTunesPanelContent();
            });

            button.addEventListener('mouseenter', () => {
                if (currentTab !== tab.id) {
                    button.style.background = 'rgba(255, 255, 255, 0.05)';
                    button.style.color = 'white';
                }
            });

            button.addEventListener('mouseleave', () => {
                if (currentTab !== tab.id) {
                    button.style.background = 'transparent';
                    button.style.color = '#999';
                }
            });

            tabNav.appendChild(button);
        });

        const content = document.createElement('div');
        content.id = 'truetunes-panel-content';
        content.style.cssText = `
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        color: white;
        min-height: 0;
    `;

        panel.appendChild(header);
        panel.appendChild(tabNav);
        panel.appendChild(content);
        modal.appendChild(panel);

        document.body.appendChild(modal);

        document.getElementById('truetunes-close').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        renderTrueTunesPanel();
    }

    function updateTrueTunesPanelContent() {
        const tabButtons = document.querySelectorAll('.truetunes-tab');
        tabButtons.forEach(button => {
            const tabId = button.dataset.tab;
            const isActive = currentTab === tabId;

            button.style.background = isActive ? 'rgba(126, 34, 206, 0.2)' : 'transparent';
            button.style.color = isActive ? '#7e22ce' : '#999';
            button.style.borderBottom = `2px solid ${isActive ? '#7e22ce' : 'transparent'}`;
        });

        renderTrueTunesPanel();
    }

    function createTrueTunesButton() {
        const topBarRight = document.querySelector('.main-topBar-topbarContentRight');
        if (!topBarRight) {
            setTimeout(createTrueTunesButton, 500);
            return;
        }

        if (document.getElementById('truetunes-button')) return;

        const button = document.createElement('button');
        button.id = 'truetunes-button';
        button.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(135deg, #7e22ce 0%, #db2777 100%);
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 8px;
            box-shadow: 0 4px 12px rgba(126, 34, 206, 0.3);
            transition: all 0.2s;
            position: relative;
        `;

        button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 32 32" fill="white">
                <path d="M16 2C8.3 2 2 8.3 2 16s6.3 14 14 14 14-6.3 14-14S23.7 2 16 2zm0 4c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zM8 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm8 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0-8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm8 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
            </svg>
        `;

        if (!settings.githubLinked) {
            const badge = document.createElement('div');
            badge.style.cssText = `
                position: absolute;
                top: -2px;
                right: -2px;
                width: 12px;
                height: 12px;
                background: #ef4444;
                border-radius: 50%;
                border: 2px solid #121212;
            `;
            button.appendChild(badge);
        }

        button.addEventListener('mouseenter', () => {
            button.style.transform = 'scale(1.1)';
            button.style.boxShadow = '0 6px 20px rgba(126, 34, 206, 0.5)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.transform = 'scale(1)';
            button.style.boxShadow = '0 4px 12px rgba(126, 34, 206, 0.3)';
        });

        button.addEventListener('click', showTrueTunesPanel);

        topBarRight.insertBefore(button, topBarRight.firstChild);
    }

    // ===== CORE FUNCTIONALITY =====

    async function loadFlaggedList() {
        try {
            const response = await fetch(GITHUB_RAW + '?t=' + Date.now());
            const data = await response.json();

            flaggedArtists.clear();
            data.artists.forEach(artist => {
                if (artist.platforms && artist.platforms.spotify) {
                    flaggedArtists.set(artist.platforms.spotify, artist);
                }
            });

            if (settings.highlightInPlaylists) {
                setTimeout(() => highlightPlaylistItems(), 1000);
            }
        } catch (error) {
            console.error('[TrueTunes] Failed to load list:', error);
        }
    }

    async function loadPendingArtists() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/Lewdcifer666/TrueTunes/main/data/pending.json?t=' + Date.now());
            const data = await response.json();

            window.trueTunesPending = new Map();
            data.artists.forEach(artist => {
                if (artist.platforms && artist.platforms.spotify) {
                    // Normalize key: remove "spotify:" prefix
                    const normalizedId = artist.platforms.spotify;
                    window.trueTunesPending.set(normalizedId, {
                        name: artist.name,
                        votes: artist.votes || 0,
                        reporters: artist.reporters || []
                    });
                }
            });

            console.log('[TrueTunes] Loaded', window.trueTunesPending.size, 'pending artists');
        } catch (error) {
            console.error('[TrueTunes] Failed to load pending artists:', error);
        }
    }

    function checkCurrentTrack() {
        try {
            if (!Spicetify?.Player?.data?.item) return;

            const item = Spicetify.Player.data.item;
            let artistUri = item.metadata?.reason_artist ||
                item.metadata?.artist_uri ||
                (item.artists && item.artists[0]?.uri);

            if (!artistUri) return;

            const artistId = artistUri.split(':').pop();
            const flagged = flaggedArtists.get(artistId);

            if (flagged && flagged.votes >= 10) {
                handleFlaggedTrack(flagged);
            }
        } catch (e) {
            console.error('[TrueTunes] Error checking track:', e);
        }
    }

    function handleFlaggedTrack(artist) {
        try {
            if (settings.showWarnings) {
                Spicetify.showNotification(
                    `⚠️ AI Generated Music Detected (${artist.votes} votes)`,
                    false,
                    5000
                );
            }

            if (settings.autoSkip) {
                setTimeout(() => Spicetify.Player.next(), 500);
            }

            if (settings.autoHide) {
                try {
                    const uri = Spicetify.Player.data.track.uri;
                    Spicetify.Platform.PlayerAPI.skipToNext();
                } catch (error) {
                    console.error('[TrueTunes] Failed to hide:', error);
                }
            }

            if (settings.autoDislike) {
                try {
                    const uri = Spicetify.Player.data.track.uri;
                    Spicetify.Platform.LibraryAPI.remove({ uris: [uri] });
                } catch (error) {
                    console.error('[TrueTunes] Failed to remove:', error);
                }
            }
        } catch (e) {
            console.error('[TrueTunes] Error handling flagged track:', e);
        }
    }

    async function voteOnArtist(artistId, artistName = "Unknown Artist") {
        try {
            if (!settings.githubLinked) {
                Spicetify.showNotification('⚠️ Please connect your GitHub account to vote', true, 4000);
                setTimeout(() => showTrueTunesPanel(), 500);
                return;
            }

            if (hasVoted(artistId)) {
                const voteData = votedArtists.get(artistId);
                Spicetify.showNotification(`You've already voted for ${artistName} (Issue #${voteData.issueNumber})`, true, 3000);
                return;
            }

            const title = `Vote: ${artistName}`;
            const body = `Platform: Spotify\nArtist ID: ${artistId}\nVote: ai\n\nAuto-generated by TrueTunes extension`;

            const url = `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=vote`;

            window.open(url, '_blank');

            Spicetify.showNotification(
                `📝 GitHub issue opened for ${artistName}\nYour vote will be verified in 30 seconds`,
                false,
                5000
            );

            setTimeout(() => verifyRecentVotes(), 30000);
        } catch (e) {
            console.error('[TrueTunes] Error voting:', e);
        }
    }

    async function getArtistNameFromUri(uri) {
        try {
            const artistId = uri.split(':')[2];

            const flagged = flaggedArtists.get(artistId);
            if (flagged?.name) {
                return flagged.name;
            }

            const response = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/artists/${artistId}`);
            if (response?.name) {
                return response.name;
            }
        } catch (e) {
            console.error('[TrueTunes] Error fetching artist name:', e);
        }

        return "Unknown Artist";
    }

    function getCurrentArtistPageId() {
        try {
            if (typeof Spicetify !== 'undefined' && Spicetify.Platform?.History) {
                try {
                    const pathname = Spicetify.Platform.History.location.pathname;
                    const match = pathname.match(/\/artist\/([a-zA-Z0-9]+)/);
                    if (match) {
                        return match[1];
                    }
                } catch (e) { }
            }

            const urlMatch = window.location.pathname.match(/\/artist\/([a-zA-Z0-9]+)/);
            if (urlMatch) {
                return urlMatch[1];
            }

            const artistLinks = document.querySelectorAll('a[href*="spotify:artist:"], a[href*="/artist/"]');
            for (const link of artistLinks) {
                const href = link.getAttribute('href');

                let match = href.match(/spotify:artist:([a-zA-Z0-9]+)/);
                if (match) {
                    return match[1];
                }

                match = href.match(/\/artist\/([a-zA-Z0-9]+)/);
                if (match) {
                    return match[1];
                }
            }

            return null;
        } catch (e) {
            console.error('[TrueTunes] Error getting artist ID:', e);
            return null;
        }
    }

    function getCurrentArtistPageName() {
        try {
            const mainContent = document.querySelector('main, [role="main"]');
            if (mainContent) {
                const headings = mainContent.querySelectorAll('h1, [class*="entityHeader"] h1, [class*="EntityHeader"] h1');
                for (const heading of headings) {
                    const text = heading.textContent.trim();
                    if (text &&
                        text.length > 2 &&
                        text.length < 100 &&
                        !['Popular', 'Discography', 'About', 'Featuring', 'Your Library', 'Playlists'].includes(text)) {
                        return text;
                    }
                }
            }

            const entityHeader = document.querySelector('.main-entityHeader-container, [class*="EntityHeader"]');
            if (entityHeader) {
                const heading = entityHeader.querySelector('h1, [class*="title"]');
                if (heading) {
                    const text = heading.textContent.trim();
                    if (text && text.length > 2 && text.length < 100) {
                        return text;
                    }
                }
            }

            const title = document.title;
            if (title) {
                const cleanTitle = title.replace(/\s*-\s*Spotify\s*$/, '').trim();
                if (cleanTitle &&
                    cleanTitle !== 'Spotify' &&
                    cleanTitle !== 'Your Library' &&
                    !cleanTitle.includes('Playlists')) {
                    return cleanTitle;
                }
            }

            return "Unknown Artist";
        } catch (e) {
            console.error('[TrueTunes] Error getting artist name:', e);
            return "Unknown Artist";
        }
    }

    function isOnArtistPage() {
        if (window.location.pathname.includes('/artist/') ||
            window.location.href.includes('spotify:artist:')) {
            return true;
        }

        const hasArtistHeader = document.querySelector('[data-testid="artist-page"]') ||
            document.querySelector('section[aria-label*="Artist"]') ||
            document.querySelector('.main-entityHeader-container');

        const hasPopularSection = document.querySelector('h2')?.textContent === 'Popular' ||
            Array.from(document.querySelectorAll('h2, h3')).some(h =>
                h.textContent.trim() === 'Popular'
            );

        return hasArtistHeader && hasPopularSection;
    }

    // ===== UI STYLING =====

    function injectStyles() {
        try {
            const style = document.createElement('style');
            style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes slideUp {
                from { 
                    opacity: 0;
                    transform: translateY(20px);
                }
                to { 
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            #truetunes-panel-content {
                transition: opacity 0.15s ease;
                overflow-y: visible !important;
            }

            .truetunes-tab {
                transition: all 0.2s ease !important;
            }
            
            #toggle-history-view {
                transition: all 0.2s ease !important;
            }
            
            #history-content-area {
                transition: opacity 0.15s ease !important;
            }

            .truetunes-flagged-row {
                background: rgba(239, 68, 68, 0.1) !important;
                border-left: 3px solid #ef4444 !important;
            }
            
            .truetunes-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                border-radius: 12px;
                background: rgba(239, 68, 68, 0.2);
                color: #ef4444;
                font-size: 10px;
                font-weight: 600;
                margin-left: 8px;
                vertical-align: middle;
                flex-shrink: 0;
            }
            
            .truetunes-vote-button {
                display: inline-flex;
                margin-left: 12px;
                margin-right: 8px;
                opacity: 1;
                transition: opacity 0.2s;
                flex-shrink: 0;
            }
            
            .truetunes-vote-button.not-voted {
                opacity: 0;
            }
            
            .main-trackList-trackListRow:hover .truetunes-vote-button.not-voted,
            [data-testid="tracklist-row"]:hover .truetunes-vote-button.not-voted {
                opacity: 1;
            }
            
            .truetunes-vote-btn {
                min-width: 36px;
                height: 28px;
                padding: 0 10px;
                border-radius: 14px;
                border: 1px solid rgba(239, 68, 68, 0.3);
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                font-size: 11px;
                font-weight: 700;
                transition: all 0.2s;
                background: rgba(239, 68, 68, 0.15);
                color: #ef4444;
            }
            
            .truetunes-vote-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
                background: rgba(239, 68, 68, 0.25);
            }
            
            .truetunes-vote-btn.voted {
                cursor: not-allowed;
                opacity: 0.5;
                background: rgba(100, 100, 100, 0.2);
                color: #888;
                border-color: rgba(100, 100, 100, 0.3);
            }
            
            .truetunes-vote-btn.voted:hover {
                transform: none;
                box-shadow: none;
                background: rgba(100, 100, 100, 0.2);
            }

            /* Skip AI Toggle Button */
            .truetunes-skip-toggle {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 6px 12px;
                border-radius: 4px;
                border: 1px solid;
                cursor: pointer;
                font-size: 12px;
                font-weight: 700;
                transition: all 0.2s;
                margin: 0 4px;
                white-space: nowrap;
                user-select: none;
            }

            .truetunes-skip-toggle.enabled {
                background: rgba(34, 197, 94, 0.2);
                border-color: rgba(34, 197, 94, 0.4);
                color: #22c55e;
            }

            .truetunes-skip-toggle.enabled:hover {
                background: rgba(34, 197, 94, 0.3);
                border-color: #22c55e;
                transform: scale(1.05);
            }

            .truetunes-skip-toggle.disabled {
                background: rgba(100, 100, 100, 0.1);
                border-color: rgba(100, 100, 100, 0.3);
                color: #999;
            }

            .truetunes-skip-toggle.disabled:hover {
                background: rgba(100, 100, 100, 0.2);
                border-color: rgba(100, 100, 100, 0.4);
                transform: scale(1.05);
            }

            /* Community Feed Sidebar */
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                }
                to {
                    transform: translateX(0);
                }
            }
            
            .truetunes-feed-toggle {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 6px 12px;
                border-radius: 4px;
                border: 1px solid rgba(126, 34, 206, 0.3);
                cursor: pointer;
                font-size: 12px;
                font-weight: 700;
                transition: all 0.2s;
                margin: 0 4px;
                white-space: nowrap;
                user-select: none;
                background: rgba(126, 34, 206, 0.1);
                color: #7e22ce;
            }
            
            .truetunes-feed-toggle:hover {
                background: rgba(126, 34, 206, 0.2);
                border-color: #7e22ce;
                transform: scale(1.05);
            }
            
            .truetunes-feed-sidebar {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            
            .truetunes-feed-sidebar.detached .truetunes-sidebar-header {
                border-radius: 12px 12px 0 0;
            }

            .truetunes-feed-sidebar.docked {
                overflow: visible;
                min-width: 300px;
                max-width: 600px;
            }
            
            .truetunes-sidebar-resizer {
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                width: 8px;
                cursor: ew-resize;
                background: transparent;
                z-index: 10;
            }
            
            .truetunes-sidebar-resizer:hover {
                background: rgba(126, 34, 206, 0.3);
            }
            
            .truetunes-feed-sidebar.detached {
                resize: both;
                overflow: hidden;
                min-width: 300px;
                min-height: 400px;
            }
            
            .truetunes-feed-sidebar::-webkit-scrollbar {
                width: 8px;
            }
            
            .truetunes-feed-sidebar::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
            }
            
            .truetunes-feed-sidebar::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
            }
            
            #truetunes-sidebar-content::-webkit-scrollbar {
                width: 8px;
            }
            
            #truetunes-sidebar-content::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
            }
            
            #truetunes-sidebar-content::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
            }
        `;
            document.head.appendChild(style);
        } catch (e) {
            console.error('[TrueTunes] Error injecting styles:', e);
        }
    }

    function getArtistIdFromRow(row) {
        try {
            const artistLink = row.querySelector('a[href*="/artist/"]');
            if (artistLink) {
                const href = artistLink.getAttribute('href');
                const match = href.match(/\/artist\/([a-zA-Z0-9]+)/);
                if (match) return match[1];
            }
        } catch (e) { }
        return null;
    }

    function getArtistNameFromRow(row) {
        try {
            const artistLink = row.querySelector('a[href*="/artist/"]');
            if (artistLink) return artistLink.textContent.trim();
        } catch (e) { }
        return "Unknown Artist";
    }

    function addVoteButtonToRow(row) {
        try {
            const existing = row.querySelector('.truetunes-vote-button');

            const artistId = getArtistIdFromRow(row);
            if (!artistId) {
                return;
            }

            const artistName = getArtistNameFromRow(row);
            const alreadyVoted = hasVoted(artistId);

            if (existing) {
                const wasVoted = existing.classList.contains('voted-state');
                if (wasVoted === alreadyVoted) return;
                existing.remove();
            }

            const insertionStrategies = [
                () => row.querySelector('[data-testid="tracklist-row"] > div:last-child'),
                () => row.querySelector('.main-trackList-rowSectionEnd'),
                () => row.querySelector('div:last-child'),
                () => {
                    const container = document.createElement('div');
                    container.style.cssText = 'display: flex; align-items: center; margin-left: auto;';
                    row.appendChild(container);
                    return container;
                }
            ];

            let buttonContainer = null;
            for (const strategy of insertionStrategies) {
                buttonContainer = strategy();
                if (buttonContainer) {
                    break;
                }
            }

            if (!buttonContainer) {
                return;
            }

            const voteButton = document.createElement('div');
            voteButton.className = 'truetunes-vote-button';

            if (alreadyVoted) {
                const voteData = votedArtists.get(artistId);
                voteButton.classList.add('voted-state');
                voteButton.innerHTML = `
                <button class="truetunes-vote-btn voted" title="You voted in issue #${voteData.issueNumber}" disabled>
                    ✓ Voted
                </button>
            `;
            } else {
                voteButton.classList.add('not-voted');
                voteButton.innerHTML = `
                <button class="truetunes-vote-btn" title="Report as AI Generated">
                    🚨 AI
                </button>
            `;

                voteButton.querySelector('.truetunes-vote-btn').onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    voteOnArtist(artistId, artistName);
                };
            }

            buttonContainer.insertBefore(voteButton, buttonContainer.firstChild);

        } catch (e) {
            console.error('[TrueTunes] Error in addVoteButtonToRow:', e);
        }
    }

    // FIXED: Improved artist page button logic with better debouncing
    function addArtistPageVoteButton() {
        try {
            // Clear any existing debounce timer
            if (artistPageButtonDebounce) {
                clearTimeout(artistPageButtonDebounce);
            }

            // Debounce the button addition
            artistPageButtonDebounce = setTimeout(() => {
                // ===== IMPROVED ARTIST PAGE DETECTION =====
                // PRIMARY METHOD: Check data-test-uri attribute (most reliable!)
                const section = document.querySelector('section[data-test-uri]');
                const testUri = section?.getAttribute('data-test-uri');

                // CRITICAL: Reject if it's a playlist page
                if (testUri && testUri.includes('spotify:playlist')) {
                    return; // Silent return - this is a playlist, not an artist
                }

                // Accept if it's explicitly an artist page
                const isArtistByUri = testUri && testUri.includes('spotify:artist');

                // Fallback detection methods
                const pathname = window.location.pathname;
                const isArtistURL = pathname.includes('/artist/');

                const artistPageIndicators = [
                    document.querySelector('[data-testid="artist-page"]'),
                    document.querySelector('section[aria-label*="Artist"]'),
                    document.querySelector('[data-testid="entity-header"]'),
                    document.querySelector('.main-entityHeader-container'),
                    Array.from(document.querySelectorAll('h2')).find(h => h.textContent.trim() === 'Popular')
                ];

                const onArtistPage = isArtistByUri ||
                    isArtistURL ||
                    artistPageIndicators.some(el => el !== null && el !== undefined);

                if (!onArtistPage) {
                    return; // Silent return
                }

                const artistId = getCurrentArtistPageId();
                const artistName = getCurrentArtistPageName();

                if (!artistId) {
                    return; // Silent return
                }

                // CRITICAL: Wait for valid artist name to load before adding button
                if (!artistName ||
                    artistName === "Unknown Artist" ||
                    artistName === "Spotify" ||
                    artistName.length < 1) {
                    return; // Page not fully loaded yet, retry on next interval
                }

                // CRITICAL: Pre-check that action bar exists BEFORE processing
                // Try all strategies to find action bar
                let actionBarPreCheck = document.querySelector('.main-actionBar-ActionBarRow') ||
                    document.querySelector('.main-entityHeader-actionBar') ||
                    document.querySelector('[data-testid="entity-header"] [class*="ActionBar"]') ||
                    document.querySelector('[class*="ActionBarRow"]');

                // If no action bar found, try finding by Play button container
                if (!actionBarPreCheck) {
                    const playButton = document.querySelector('[data-testid="play-button"]');
                    if (playButton) {
                        let parent = playButton.parentElement;
                        let attempts = 0;
                        while (parent && attempts < 5) {
                            const buttons = parent.querySelectorAll('button');
                            if (buttons.length >= 2) {
                                actionBarPreCheck = parent;
                                break;
                            }
                            parent = parent.parentElement;
                            attempts++;
                        }
                    }
                }

                // If still no action bar, DOM not ready - retry later
                if (!actionBarPreCheck) {
                    console.log('[TrueTunes] Action bar not found yet for', artistName, '- will retry');
                    return; // Retry on next interval
                }

                // FIXED: Only skip if button already exists in DOM AND we just processed this artist
                const buttonCheck = document.querySelector('.truetunes-artist-page-button');
                if (lastProcessedArtistId === artistId && buttonCheck) {
                    return; // Button exists, no need to recreate
                }

                // Reset if button is missing (page re-rendered)
                if (!buttonCheck) {
                    lastProcessedArtistId = null;
                }

                lastProcessedArtistId = artistId;

                const alreadyVoted = hasVoted(artistId);
                const isFlagged = flaggedArtists.has(artistId);

                // Remove existing button if present
                const existingButton = document.querySelector('.truetunes-artist-page-button');
                if (existingButton) {
                    existingButton.remove();
                }

                // ===== IMPROVED ACTION BAR FINDING =====
                // Try multiple strategies to find where to place the button

                let actionBarRow = null;

                // Strategy 1: Look for the main action bar row (most common)
                actionBarRow = document.querySelector('.main-actionBar-ActionBarRow');

                // Strategy 2: Look for entity header action bar
                if (!actionBarRow) {
                    actionBarRow = document.querySelector('.main-entityHeader-actionBar');
                }

                // Strategy 3: Look for the action bar within entity header
                if (!actionBarRow) {
                    const entityHeader = document.querySelector('[data-testid="entity-header"]');
                    if (entityHeader) {
                        actionBarRow = entityHeader.querySelector('[class*="ActionBar"]') ||
                            entityHeader.querySelector('[class*="actionBar"]');
                    }
                }

                // Strategy 4: Look for any element with action bar in class name
                if (!actionBarRow) {
                    actionBarRow = document.querySelector('[class*="ActionBarRow"]') ||
                        document.querySelector('[class*="actionBarRow"]');
                }

                // Strategy 5: Find by looking for Play/Follow button container
                if (!actionBarRow) {
                    const playButton = document.querySelector('[data-testid="play-button"]') ||
                        document.querySelector('[aria-label*="Play"]');
                    if (playButton) {
                        // Go up the DOM tree to find the container
                        let parent = playButton.parentElement;
                        let attempts = 0;
                        while (parent && attempts < 5) {
                            // Look for a container that has multiple buttons
                            const buttons = parent.querySelectorAll('button');
                            if (buttons.length >= 2) { // At least Play + Follow
                                actionBarRow = parent;
                                break;
                            }
                            parent = parent.parentElement;
                            attempts++;
                        }
                    }
                }

                // Strategy 6: Last resort - find the topmost button container in main view
                if (!actionBarRow) {
                    const mainView = document.querySelector('.main-view-container__scroll-node-child') ||
                        document.querySelector('[data-testid="main-view-container"]');
                    if (mainView) {
                        // Find first div with multiple buttons
                        const allDivs = mainView.querySelectorAll('div');
                        for (const div of allDivs) {
                            const buttons = div.querySelectorAll(':scope > button');
                            if (buttons.length >= 2) {
                                actionBarRow = div;
                                break;
                            }
                        }
                    }
                }

                if (!actionBarRow) {
                    console.log('[TrueTunes] Could not find action bar for button placement');
                    return; // Give up silently
                }

                // ===== CREATE THE BUTTON =====
                const buttonContainer = document.createElement('div');
                buttonContainer.className = 'truetunes-artist-page-button';
                buttonContainer.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 8px;
                margin-left: 8px;
            `;

                // Add flagged badge if artist is already flagged
                if (isFlagged) {
                    const flagged = flaggedArtists.get(artistId);
                    const badge = document.createElement('div');
                    badge.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    border-radius: 500px;
                    background: rgba(239, 68, 68, 0.2);
                    border: 1px solid rgba(239, 68, 68, 0.4);
                    color: #ef4444;
                    font-size: 14px;
                    font-weight: 700;
                    white-space: nowrap;
                `;
                    badge.innerHTML = `⚠️ AI (${flagged.votes})`;
                    badge.title = `Flagged as AI-generated with ${flagged.votes} community votes`;
                    buttonContainer.appendChild(badge);
                }

                // Create the vote button
                const voteButton = document.createElement('button');
                voteButton.className = 'truetunes-artist-vote-btn';
                voteButton.style.cssText = `
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 8px 32px;
                border-radius: 500px;
                border: 1px solid ${alreadyVoted ? 'rgba(255, 255, 255, 0.3)' : 'rgba(239, 68, 68, 0.6)'};
                background-color: ${alreadyVoted ? 'transparent' : 'rgba(239, 68, 68, 0.2)'};
                color: ${alreadyVoted ? 'rgba(255, 255, 255, 0.7)' : '#ef4444'};
                font-size: 14px;
                font-weight: 700;
                cursor: ${alreadyVoted ? 'not-allowed' : 'pointer'};
                transition: all 0.2s;
                white-space: nowrap;
                min-height: 32px;
                font-family: inherit;
            `;

                if (alreadyVoted) {
                    const voteData = votedArtists.get(artistId);
                    voteButton.innerHTML = `✓ Voted`;
                    voteButton.title = `You voted for ${artistName} in issue #${voteData.issueNumber}`;
                    voteButton.disabled = true;
                } else {
                    voteButton.innerHTML = `🚨 Report AI`;
                    voteButton.title = `Report ${artistName} as AI-generated`;

                    voteButton.addEventListener('mouseenter', () => {
                        if (!alreadyVoted) {
                            voteButton.style.backgroundColor = 'rgba(239, 68, 68, 0.3)';
                            voteButton.style.borderColor = '#ef4444';
                            voteButton.style.transform = 'scale(1.04)';
                        }
                    });

                    voteButton.addEventListener('mouseleave', () => {
                        if (!alreadyVoted) {
                            voteButton.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                            voteButton.style.borderColor = 'rgba(239, 68, 68, 0.6)';
                            voteButton.style.transform = 'scale(1)';
                        }
                    });

                    voteButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        voteOnArtist(artistId, artistName);
                    });
                }

                buttonContainer.appendChild(voteButton);

                // Insert the button into the action bar
                // Try to insert after the last button, or just append
                const lastButton = actionBarRow.querySelector('button:last-of-type');
                if (lastButton && lastButton.parentElement === actionBarRow) {
                    actionBarRow.insertBefore(buttonContainer, lastButton.nextSibling);
                } else {
                    actionBarRow.appendChild(buttonContainer);
                }

                console.log('[TrueTunes] ✓ Button added to artist page:', artistName);

            }, 500); // 500ms debounce

        } catch (e) {
            // Silent error handling - no console spam
            console.error('[TrueTunes] Error in addArtistPageVoteButton:', e.message);
        }
    }

    function addVoteButtonsToArtistPage() {
        addArtistPageVoteButton();
    }

    function watchForArtistPages() {
        let lastUrl = window.location.href;
        let checkInterval = null;

        function checkUrlAndAddButton() {
            const currentUrl = window.location.href;

            // URL changed
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                lastProcessedArtistId = null; // Reset processed artist

                // Clear any existing buttons
                const existingButton = document.querySelector('.truetunes-artist-page-button');
                if (existingButton) {
                    existingButton.remove();
                }

                // If we're on an artist page, add the button
                if (currentUrl.includes('/artist/')) {
                    setTimeout(() => {
                        addArtistPageVoteButton();
                    }, 1000); // Wait for page to load
                }
            }
            // Even if URL hasn't changed, check if we should add button
            else if (currentUrl.includes('/artist/')) {
                const buttonExists = document.querySelector('.truetunes-artist-page-button');
                if (!buttonExists) {
                    addArtistPageVoteButton();
                }
            }
        }

        // Check every 1 second
        checkInterval = setInterval(checkUrlAndAddButton, 1000);

        // Also use MutationObserver for faster detection
        const observer = new MutationObserver((mutations) => {
            // Only check if we're potentially on an artist page
            if (window.location.pathname.includes('/artist/')) {
                const buttonExists = document.querySelector('.truetunes-artist-page-button');
                if (!buttonExists) {
                    addArtistPageVoteButton();
                }
            }
        });

        // Observe the main content area for changes
        const mainContent = document.querySelector('.main-view-container') || document.body;
        observer.observe(mainContent, {
            childList: true,
            subtree: true
        });

        // Initial check
        setTimeout(() => {
            if (window.location.pathname.includes('/artist/')) {
                addArtistPageVoteButton();
            }
        }, 2000);
    }

    // ===== COMPLETE SKIP AI TOGGLE SYSTEM =====
    // Copy ALL of these functions into your code

    // Helper: Get existing button or create new one
    function getSkipButton() {
        let btn = document.getElementById('truetunes-skip-toggle');

        if (btn) {
            return btn; // Reuse existing
        }

        // Create new
        btn = document.createElement('button');
        btn.id = 'truetunes-skip-toggle';
        btn.className = `truetunes-skip-toggle ${settings.autoSkip ? 'enabled' : 'disabled'}`;
        btn.setAttribute('aria-label', 'Toggle Auto-Skip AI Tracks');

        updateSkipToggleContent(btn);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleAutoSkip();
        });

        return btn;
    }

    // Main: Create and position button
    function createSkipAIToggle() {
        if (skipButtonInitialized) {
            return; // Already initialized
        }

        const extraControls = document.querySelector('.main-nowPlayingBar-extraControls');
        if (!extraControls) {
            setTimeout(createSkipAIToggle, 1000);
            return;
        }

        skipButtonInitialized = true;

        // Get button (existing or new)
        const btn = getSkipButton();

        // If already in DOM, don't re-add
        if (btn.parentElement) {
            return;
        }

        // Find Spicy Lyrics
        const spicy = extraControls.querySelector('[id^="SpicyLyrics"]');

        if (spicy) {
            // Found it - insert before
            extraControls.insertBefore(btn, spicy);
            console.log('[TrueTunes] ✓ Skip AI button created before Spicy Lyrics');
        } else {
            // Not found - insert at start and watch
            extraControls.insertBefore(btn, extraControls.firstChild);
            console.log('[TrueTunes] Skip AI button created, watching for Spicy Lyrics...');
            watchForSpicyLyrics();
        }
    }

    // Watcher: Reposition when Spicy Lyrics appears
    function watchForSpicyLyrics() {
        if (spicyWatcherRunning) return;
        spicyWatcherRunning = true;

        let attempts = 0;

        const check = setInterval(() => {
            const btn = document.getElementById('truetunes-skip-toggle');
            const extraControls = document.querySelector('.main-nowPlayingBar-extraControls');

            if (!btn || !extraControls) {
                clearInterval(check);
                spicyWatcherRunning = false;
                return;
            }

            const spicy = extraControls.querySelector('[id^="SpicyLyrics"]');

            if (spicy && spicy.parentElement === extraControls) { // FIX: Check parent
                const buttons = Array.from(extraControls.children);
                const skipIdx = buttons.indexOf(btn);
                const spicyIdx = buttons.indexOf(spicy);

                if (skipIdx > spicyIdx && btn.parentElement === extraControls) { // FIX: Check parent
                    extraControls.removeChild(btn);
                    extraControls.insertBefore(btn, spicy);
                    console.log('[TrueTunes] ✓ Repositioned before Spicy Lyrics');
                }

                clearInterval(check);
                spicyWatcherRunning = false;
            } else if (++attempts >= 20) {
                clearInterval(check);
                spicyWatcherRunning = false;
            }
        }, 500);
    }

    // Update: Button content based on settings
    function updateSkipToggleContent(button) {
        if (!button) {
            button = document.getElementById('truetunes-skip-toggle');
            if (!button) return;
        }

        if (settings.autoSkip) {
            button.className = 'truetunes-skip-toggle enabled';
            button.innerHTML = '⏭️ Skip AI';
            button.title = 'Auto-skip is ON - AI tracks will be skipped automatically';
        } else {
            button.className = 'truetunes-skip-toggle disabled';
            button.innerHTML = '⏸️ Skip AI';
            button.title = 'Auto-skip is OFF - Click to enable automatic skipping of AI tracks';
        }
    }

    // Toggle: Handle button clicks
    function toggleAutoSkip() {
        settings.autoSkip = !settings.autoSkip;
        saveSettings();

        updateSkipToggleContent();

        const checkbox = document.getElementById('truetunes-setting-skip');
        if (checkbox) {
            checkbox.checked = settings.autoSkip;
        }

        Spicetify.showNotification(
            settings.autoSkip
                ? '✓ Auto-skip enabled - AI tracks will be skipped'
                : '✗ Auto-skip disabled',
            false,
            2000
        );
    }

    // Monitor: Keep button alive
    function watchNowPlayingBar() {
        setTimeout(createSkipAIToggle, 2000);

        setInterval(() => {
            const btn = document.getElementById('truetunes-skip-toggle');

            if (!btn) {
                skipButtonInitialized = false;
                createSkipAIToggle();
            } else {
                updateSkipToggleContent(btn);
            }
        }, 5000); // Changed from 15000 to 5000 (5 seconds instead of 15)
    }

    // ===== UTILITY FUNCTIONS =====

    function formatTimeAgo(dateString) {
        const now = new Date();
        const past = new Date(dateString);
        const diffMs = now - past;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${diffDays}d ago`;
    }

    // ===== COMMUNITY FEED SIDEBAR BUTTON =====
    let feedSidebarOpen = false;
    let feedSidebarDetached = false;

    function getCommunityFeedButton() {
        let btn = document.getElementById('truetunes-feed-toggle');

        if (btn) {
            return btn;
        }

        btn = document.createElement('button');
        btn.id = 'truetunes-feed-toggle';
        btn.className = 'truetunes-feed-toggle';
        btn.setAttribute('aria-label', 'Toggle Community Feed');
        btn.innerHTML = '🌍 Feed';
        btn.title = 'Show Community Activity Feed';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCommunityFeedSidebar();
        });

        return btn;
    }

    function createCommunityFeedToggle() {
        const extraControls = document.querySelector('.main-nowPlayingBar-extraControls');
        if (!extraControls) {
            setTimeout(createCommunityFeedToggle, 1000);
            return;
        }

        const btn = getCommunityFeedButton();
        if (btn.parentElement) return;

        // Find Skip AI button
        const skipBtn = document.getElementById('truetunes-skip-toggle');
        const spicy = extraControls.querySelector('[id^="SpicyLyrics"]');

        if (skipBtn) {
            // Insert after Skip AI button
            if (skipBtn.nextSibling) {
                extraControls.insertBefore(btn, skipBtn.nextSibling);
            } else {
                extraControls.appendChild(btn);
            }
        } else if (spicy) {
            // Fallback: insert before Spicy Lyrics
            extraControls.insertBefore(btn, spicy);
        } else {
            // Last resort: append
            extraControls.appendChild(btn);
        }

        console.log('[TrueTunes] ✓ Community Feed button created');
    }

    function toggleCommunityFeedSidebar() {
        if (feedSidebarOpen) {
            closeCommunityFeedSidebar();
        } else {
            openCommunityFeedSidebar();
        }
    }

    function openCommunityFeedSidebar() {
        if (feedSidebarOpen) return;

        feedSidebarOpen = true;
        feedSidebarDetached = false;

        const sidebar = createCommunityFeedSidebar();
        document.body.appendChild(sidebar);

        // Update button
        const btn = document.getElementById('truetunes-feed-toggle');
        if (btn) {
            btn.style.background = 'rgba(126, 34, 206, 0.3)';
            btn.style.borderColor = '#7e22ce';
        }
    }

    function closeCommunityFeedSidebar() {
        feedSidebarOpen = false;
        feedSidebarDetached = false;

        const sidebar = document.getElementById('truetunes-feed-sidebar');
        if (sidebar) {
            sidebar.remove();
        }

        // Update button
        const btn = document.getElementById('truetunes-feed-toggle');
        if (btn) {
            btn.style.background = '';
            btn.style.borderColor = '';
        }
    }

    function createSidebarCommunityFeed() {
        const MIN_VOTES = 10;

        // Group activities by artist
        const artistGroups = new Map();

        communityFeed.recentActivity.forEach(activity => {
            const normalizedId = activity.artistId?.replace(/^spotify:/, '');
            if (!normalizedId) return;

            if (!artistGroups.has(normalizedId)) {
                artistGroups.set(normalizedId, {
                    artistId: normalizedId,
                    artistName: activity.artistName,
                    platform: activity.platform,
                    reporters: [],
                    states: new Set(),
                    latestTime: activity.createdAt,
                    currentVotes: 0,
                    totalVotes: 0
                });
            }

            const group = artistGroups.get(normalizedId);
            if (!group.reporters.includes(activity.reporter)) {
                group.reporters.push(activity.reporter);
            }
            group.states.add(activity.state);

            // Count votes: open issues = current votes, all = total votes
            if (activity.state === 'open') {
                group.currentVotes++;
            }
            group.totalVotes++;

            if (new Date(activity.createdAt) > new Date(group.latestTime)) {
                group.latestTime = activity.createdAt;
            }
        });

        // Sort by latest activity
        const groupedActivities = Array.from(artistGroups.values())
            .sort((a, b) => new Date(b.latestTime) - new Date(a.latestTime));

        // Display more entries initially for sidebar (20 instead of 10)
        const displayCount = Math.min(20, groupedActivities.length);

        return `
            <div style="padding: 16px; display: flex; flex-direction: column; height: 100%;">
                <!-- Activity Feed -->
                <div id="community-feed-container" style="flex: 1; overflow-y: auto; padding-right: 8px;">
                    ${groupedActivities.length > 0 ? groupedActivities.slice(0, displayCount).map(group => {
            const isOpen = group.states.has('open');
            const isFlagged = !isOpen && group.currentVotes >= MIN_VOTES;
            const progressPercent = Math.min((group.currentVotes / MIN_VOTES) * 100, 100);

            return `
                            <div style="background: rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px; border-left: 3px solid ${isOpen ? '#22c55e' : (isFlagged ? '#ef4444' : '#999')}; transition: all 0.2s;"
                                 onmouseover="this.style.background='rgba(255, 255, 255, 0.08)';"
                                 onmouseout="this.style.background='rgba(255, 255, 255, 0.05)';">
                                
                                <!-- Header: Time + Status Badge -->
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 10px; color: #999;">
                                    <span>${formatTimeAgo(group.latestTime)}</span>
                                    <span style="background: ${isOpen ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)'}; border: 1px solid ${isOpen ? 'rgba(34, 197, 94, 0.4)' : 'rgba(100, 100, 100, 0.4)'}; color: ${isOpen ? '#22c55e' : '#999'}; padding: 3px 8px; border-radius: 10px; font-weight: 700;">
                                        ${isOpen ? 'open' : 'closed'}
                                    </span>
                                </div>
                                
                                <!-- Artist Name -->
                                <div style="margin-bottom: 8px;">
                                    <a href="https://open.spotify.com/artist/${group.artistId}" 
                                       target="_blank"
                                       style="font-weight: 600; font-size: 14px; color: white; text-decoration: none; transition: color 0.2s;"
                                       onclick="event.stopPropagation();"
                                       onmouseover="this.style.color='#7e22ce';"
                                       onmouseout="this.style.color='white';">
                                        ${group.artistName}
                                    </a>
                                </div>
                                
                                <!-- Platform and Vote Count -->
                                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; margin-bottom: ${isOpen ? '8px' : '0'};">
                                    <span style="color: #999;">🎵 ${group.platform}</span>
                                    ${isOpen ? `
                                        <span style="background: rgba(126, 34, 206, 0.2); border: 1px solid rgba(126, 34, 206, 0.4); color: #7e22ce; padding: 3px 10px; border-radius: 10px; font-weight: 700; white-space: nowrap;">
                                            ${group.currentVotes}/${MIN_VOTES} Votes
                                        </span>
                                    ` : `
                                        <span style="background: rgba(100, 100, 100, 0.2); border: 1px solid rgba(100, 100, 100, 0.4); color: #999; padding: 3px 10px; border-radius: 10px; font-weight: 700; white-space: nowrap;">
                                            ${group.totalVotes} Vote${group.totalVotes !== 1 ? 's' : ''}
                                        </span>
                                    `}
                                </div>
                                
                                <!-- Progress Bar (only for open issues) -->
                                ${isOpen ? `
                                    <div style="width: 100%; height: 3px; background: rgba(126, 34, 206, 0.2); border-radius: 2px; overflow: hidden;">
                                        <div style="height: 100%; background: linear-gradient(90deg, #7e22ce, #db2777); width: ${progressPercent}%; transition: width 0.3s ease;"></div>
                                    </div>
                                ` : ''}
                            </div>
                        `;
        }).join('') : `
                        <div style="text-align: center; color: #999; padding: 40px 20px;">
                            <div style="font-size: 40px; margin-bottom: 12px;">📭</div>
                            <p style="font-size: 13px;">No community activity yet</p>
                        </div>
                    `}
                </div>
                
                <!-- Auto-Update Notice -->
                <div style="margin-top: 12px; padding: 10px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; font-size: 10px; color: #60a5fa; text-align: center;">
                    ⏱️ Auto-updates every 10 minutes
                </div>
            </div>
        `;
    }

    function makeResizableFromLeft(sidebar) {
        const resizer = document.createElement('div');
        resizer.className = 'truetunes-sidebar-resizer';
        sidebar.appendChild(resizer);

        let startX, startWidth;

        resizer.addEventListener('mousedown', (e) => {
            startX = e.clientX;
            startWidth = parseInt(getComputedStyle(sidebar).width, 10);
            document.addEventListener('mousemove', resize);
            document.addEventListener('mouseup', stopResize);
            e.preventDefault();
        });

        function resize(e) {
            const width = startWidth - (e.clientX - startX);
            if (width >= 300 && width <= 600) {
                sidebar.style.width = width + 'px';
            }
        }

        function stopResize() {
            document.removeEventListener('mousemove', resize);
            document.removeEventListener('mouseup', stopResize);
        }
    }

    function createCommunityFeedSidebar() {
        const sidebar = document.createElement('div');
        sidebar.id = 'truetunes-feed-sidebar';
        sidebar.className = 'truetunes-feed-sidebar docked';

        // Sidebar styles
        sidebar.style.cssText = `
            position: fixed;
            right: 0;
            top: 64px;
            bottom: 0;
            width: 400px;
            background: #121212;
            border-left: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 9998;
            display: flex;
            flex-direction: column;
            animation: slideInRight 0.3s ease;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            background: linear-gradient(135deg, #7e22ce 0%, #db2777 100%);
            padding: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
        `;
        header.className = 'truetunes-sidebar-header';

        header.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 20px;">🌍</span>
                <h3 style="font-size: 16px; font-weight: 600; color: white; margin: 0;">Community Feed</h3>
            </div>
            <div style="display: flex; gap: 8px;">
                <button id="truetunes-sidebar-detach" style="background: rgba(255, 255, 255, 0.2); border: none; color: white; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px;" title="Detach sidebar">
                    📌
                </button>
                <button id="truetunes-sidebar-close" style="background: rgba(255, 255, 255, 0.2); border: none; color: white; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px;" title="Close sidebar">
                    ✕
                </button>
            </div>
        `;

        // Controls bar
        const controls = document.createElement('div');
        controls.style.cssText = `
            background: #1a1a1a;
            padding: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            gap: 8px;
            align-items: center;
            justify-content: flex-end;
        `;

        controls.innerHTML = `
            <button id="truetunes-sidebar-refresh" style="background: rgba(126, 34, 206, 0.2); border: 1px solid #7e22ce; color: #7e22ce; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
                🔄 Refresh
            </button>
        `;

        controls.innerHTML = `
            <label style="display: flex; align-items: center; gap: 6px; color: white; font-size: 12px; cursor: pointer;">
                <span style="font-size: 11px; color: #999;">Opacity:</span>
                <input type="range" id="truetunes-sidebar-opacity" min="10" max="100" value="100" step="1" style="width: 100px;">
                <span id="truetunes-opacity-value" style="min-width: 35px; text-align: right;">100%</span>
            </label>
            <div style="flex: 1;"></div>
            <button id="truetunes-sidebar-refresh" style="background: rgba(126, 34, 206, 0.2); border: 1px solid #7e22ce; color: #7e22ce; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; margin-left: auto;">
                🔄 Refresh
            </button>
        `;

        // Content container
        const content = document.createElement('div');
        content.id = 'truetunes-sidebar-content';
        content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            color: white;
            background: #121212;
        `;

        // Load community feed content
        content.innerHTML = createSidebarCommunityFeed();

        sidebar.appendChild(header);
        sidebar.appendChild(controls);
        sidebar.appendChild(content);

        // Add resizer for docked mode
        makeResizableFromLeft(sidebar);

        // Add event listeners
        setupSidebarEventListeners(sidebar, header);

        return sidebar;
    }

    function setupSidebarEventListeners(sidebar, header) {
        // Close button - use sidebar.querySelector instead of document.getElementById
        const closeBtn = sidebar.querySelector('#truetunes-sidebar-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                closeCommunityFeedSidebar();
            });
        }

        // Detach button
        const detachBtn = sidebar.querySelector('#truetunes-sidebar-detach');
        if (detachBtn) {
            detachBtn.addEventListener('click', () => {
                if (feedSidebarDetached) {
                    // Dock it back
                    sidebar.classList.remove('detached');
                    sidebar.classList.add('docked');
                    sidebar.style.cssText = `
                        position: fixed;
                        right: 0;
                        top: 64px;
                        bottom: 0;
                        width: 400px;
                        background: #121212;
                        border-left: 1px solid rgba(255, 255, 255, 0.1);
                        z-index: 9998;
                        display: flex;
                        flex-direction: column;
                        opacity: ${sidebar.style.opacity || 1};
                    `;
                    feedSidebarDetached = false;
                    detachBtn.innerHTML = '📌';
                    detachBtn.title = 'Detach sidebar';
                } else {
                    // Detach it
                    sidebar.classList.remove('docked');
                    sidebar.classList.add('detached');
                    sidebar.style.cssText = `
                        position: fixed;
                        right: 20px;
                        top: 80px;
                        width: 400px;
                        height: 600px;
                        background: #121212;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        border-radius: 12px;
                        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
                        z-index: 9998;
                        display: flex;
                        flex-direction: column;
                        opacity: ${sidebar.style.opacity || 1};
                        resize: both;
                        overflow: hidden;
                    `;
                    feedSidebarDetached = true;
                    detachBtn.innerHTML = '📍';
                    detachBtn.title = 'Dock sidebar';

                    // Enable dragging when detached
                    makeDraggable(sidebar, header);
                }
            });
        }

        // Refresh button
        const refreshBtn = sidebar.querySelector('#truetunes-sidebar-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.textContent = '⏳ Refreshing...';
                refreshBtn.disabled = true;

                await fetchCommunityActivity();

                const content = sidebar.querySelector('#truetunes-sidebar-content');
                if (content) {
                    content.innerHTML = createCommunityTab();

                    // Reattach scroll listener for lazy loading
                    const feedContainer = content.querySelector('#community-feed-container');
                    if (feedContainer) {
                        feedContainer.addEventListener('scroll', () => {
                            if (communityView.isUpdating) return;

                            const { scrollTop, scrollHeight, clientHeight } = feedContainer;
                            if (scrollTop + clientHeight >= scrollHeight * 0.8) {
                                const artistGroups = new Map();
                                communityFeed.recentActivity.forEach(activity => {
                                    const normalizedId = activity.artistId?.replace(/^spotify:/, '');
                                    if (!normalizedId) return;
                                    if (!artistGroups.has(normalizedId)) {
                                        artistGroups.set(normalizedId, { latestTime: activity.createdAt });
                                    }
                                });

                                const totalGroups = artistGroups.size;
                                if (communityView.displayedCount < totalGroups) {
                                    communityView.displayedCount += 10;
                                    updateCommunityFeedOnly();
                                }
                            }
                        });
                    }
                }

                refreshBtn.textContent = '🔄 Refresh';
                refreshBtn.disabled = false;
                Spicetify.showNotification('✓ Community feed refreshed', false, 2000);
            });
        }
    }

    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            if (!feedSidebarDetached) return;

            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            handle.style.cursor = 'grabbing';
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            element.style.top = (element.offsetTop - pos2) + 'px';
            element.style.left = (element.offsetLeft - pos1) + 'px';
            element.style.right = 'auto';
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            handle.style.cursor = 'move';
        }
    }

    function addAIBadgeToRow(row, artist) {
        try {
            if (row.querySelector('.truetunes-badge')) return;

            const artistLink = row.querySelector('a[href*="/artist/"]');
            if (!artistLink) return;

            const badge = document.createElement('span');
            badge.className = 'truetunes-badge';
            badge.innerHTML = `⚠️ AI (${artist.votes})`;
            badge.title = `Flagged as AI-generated with ${artist.votes} community votes`;

            artistLink.parentElement.appendChild(badge);
        } catch (e) {
        }
    }

    function highlightPlaylistItems() {
        if (!settings.highlightInPlaylists || isProcessing) return;

        isProcessing = true;

        try {
            const playlistRows = document.querySelectorAll('[data-testid="tracklist-row"], .main-trackList-trackListRow');

            playlistRows.forEach(row => {
                try {
                    const artistId = getArtistIdFromRow(row);
                    if (!artistId) return;

                    addVoteButtonToRow(row);

                    const flagged = flaggedArtists.get(artistId);
                    if (flagged && flagged.votes >= 10) {
                        row.classList.add('truetunes-flagged-row');
                        addAIBadgeToRow(row, flagged);
                    } else {
                        row.classList.remove('truetunes-flagged-row');
                    }
                } catch (e) {
                    // Silent fail for individual rows
                }
            });

            addVoteButtonsToArtistPage();
        } catch (e) {
            console.error('[TrueTunes] Error highlighting items:', e);
        } finally {
            isProcessing = false;
        }
    }

    function watchPlaylistChanges() {
        let timeout;
        const debouncedHighlight = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                highlightPlaylistItems();
            }, 500);
        };

        const observer = new MutationObserver(debouncedHighlight);

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            highlightPlaylistItems();
        }, 2000);

        setInterval(() => {
            highlightPlaylistItems();
        }, 10000);
    }

    // ===== INITIALIZATION =====

    async function init() {
        if (!Spicetify?.Player) {
            setTimeout(init, 100);
            return;
        }

        try {
            loadSettings();
            loadUserStats();
            loadVotedArtists();
            injectStyles();
            await loadFlaggedList();
            await loadPendingArtists();

            if (settings.githubLinked) {
                setTimeout(() => verifyRecentVotes(), 3000);
                setTimeout(() => startCommunityFeedUpdates(), 5000);
            }

            Spicetify.Player.addEventListener('songchange', () => {
                checkCurrentTrack();
                setTimeout(() => highlightPlaylistItems(), 500);
            });

            watchPlaylistChanges();
            watchForArtistPages();
            watchNowPlayingBar();
            createCommunityFeedToggle();

            setInterval(() => loadFlaggedList(), 60 * 1000); // Check every 60 seconds instead of 6 hours

            if (settings.githubLinked) {
                setInterval(() => verifyRecentVotes(), settings.verificationInterval);
            }

            createTrueTunesButton();
        } catch (e) {
            console.error('[TrueTunes] Initialization error:', e);
        }
    }

    init();

    // ===== CONTEXT MENU =====

    function registerContextMenu() {
        if (!Spicetify?.ContextMenu || !Spicetify?.React || !Spicetify?.ReactDOM) {
            setTimeout(registerContextMenu, 300);
            return;
        }

        setTimeout(() => {
            try {
                new Spicetify.ContextMenu.Item(
                    "TrueTunes: Report AI Generated",
                    async ([uri]) => {
                        const artistId = uri.split(':')[2];

                        if (!settings.githubLinked) {
                            Spicetify.showNotification('⚠️ Connect your GitHub account to vote', true, 4000);
                            setTimeout(() => showTrueTunesPanel(), 500);
                            return;
                        }

                        if (hasVoted(artistId)) {
                            const voteData = votedArtists.get(artistId);
                            Spicetify.showNotification(`You already voted (Issue #${voteData.issueNumber})`, true, 3000);
                            return;
                        }

                        const artistName = await getArtistNameFromUri(uri);
                        voteOnArtist(artistId, artistName);
                    },
                    ([uri]) => {
                        const artistId = uri.split(':')[2];
                        if (uri.split(':')[1] !== 'artist') return false;
                        return !hasVoted(artistId);
                    },
                    `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z"/></svg>`
                ).register();

                new Spicetify.ContextMenu.Item(
                    "TrueTunes: Already Voted ✓",
                    async ([uri]) => {
                        const artistId = uri.split(':')[2];
                        const voteData = votedArtists.get(artistId);
                        Spicetify.showNotification(`You voted in issue #${voteData.issueNumber}`, true, 2000);
                    },
                    ([uri]) => {
                        const artistId = uri.split(':')[2];
                        return uri.split(':')[1] === 'artist' && hasVoted(artistId);
                    },
                    `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`
                ).register();

                new Spicetify.ContextMenu.Item(
                    "TrueTunes: Open Panel",
                    showTrueTunesPanel,
                    () => true,
                    `<svg width="16" height="16" viewBox="0 0 32 32" fill="currentColor"><path d="M16 2C8.3 2 2 8.3 2 16s6.3 14 14 14 14-6.3 14-14S23.7 2 16 2zm0 4c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zM8 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm8 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0-8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm8 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`
                ).register();
            } catch (error) {
                console.error('[TrueTunes] Failed to register context menu:', error);
            }
        }, 1000);
    }

    registerContextMenu();
})();