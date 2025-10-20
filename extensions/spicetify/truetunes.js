// TrueTunes Spicetify Extension - Full Featured with GitHub OAuth
// Detects AI-generated music on Spotify

(function TrueTunes() {
    const GITHUB_RAW = "https://raw.githubusercontent.com/Lewdcifer666/TrueTunes/main/data/flagged.json";
    const GITHUB_API = "https://api.github.com/repos/Lewdcifer666/TrueTunes/issues";
    const ISSUE_URL = "https://github.com/Lewdcifer666/TrueTunes/issues/new";

    // GitHub OAuth App credentials (you'll need to create these)
    const GITHUB_CLIENT_ID = "Ov23liuuPQQQ8ydHDkOm"; // Replace with your OAuth app client ID
    const GITHUB_REDIRECT_URI = "https://192.168.2.207:8888/callback"; // Spicetify callback

    let flaggedArtists = new Map();
    let votedArtists = new Map();
    let isProcessing = false;
    let currentTab = 'account';

    let settings = {
        githubToken: null,
        githubUsername: null,
        githubAvatar: null,
        githubLinked: false,
        autoSkip: false,
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

    // ===== GITHUB OAUTH =====

    function startGithubOAuth() {
        const state = Math.random().toString(36).substring(7) + Date.now();
        localStorage.setItem('truetunes_oauth_state', state);

        const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&scope=read:user&state=${state}`;

        Spicetify.showNotification('Opening GitHub login...', false, 2000);

        // Open OAuth window
        window.open(authUrl, 'GitHub Login', 'width=600,height=800');

        // Start polling for completion
        pollForOAuthCompletion(state);
    }

    async function pollForOAuthCompletion(state) {
        const maxAttempts = 60; // 60 attempts = 2 minutes
        let attempts = 0;

        Spicetify.showNotification('Waiting for GitHub authentication...', false, 2000);

        const pollInterval = setInterval(async () => {
            attempts++;

            console.log(`[TrueTunes] Polling attempt ${attempts}/${maxAttempts}`);

            if (attempts > maxAttempts) {
                clearInterval(pollInterval);
                Spicetify.showNotification('Authentication timeout - please try again', true, 3000);
                return;
            }

            try {
                const serverUrl = GITHUB_REDIRECT_URI.replace('/callback', '');
                console.log(`[TrueTunes] Polling ${serverUrl}/poll/${state}`);

                const response = await fetch(`${serverUrl}/poll/${state}`);
                const data = await response.json();

                console.log('[TrueTunes] Poll response:', data);

                if (data.success) {
                    clearInterval(pollInterval);
                    console.log('[TrueTunes] OAuth successful!');
                    Spicetify.showNotification('✓ Authentication successful!', false, 2000);
                    await completeGithubAuth(data.token, data.user);

                    // Close and reopen panel to show updated state
                    const modal = document.getElementById('truetunes-modal');
                    if (modal) modal.remove();
                    setTimeout(() => showTrueTunesPanel(), 300);
                }
            } catch (e) {
                // Server not responding or state not found yet - keep polling
                console.log('[TrueTunes] Polling error:', e.message);
            }
        }, 2000); // Poll every 2 seconds
    }

    async function completeGithubAuth(token, userData = null) {
        try {
            // If userData not provided, fetch it
            if (!userData) {
                const response = await fetch('https://api.github.com/user', {
                    headers: {
                        'Authorization': `token ${token}`
                    }
                });

                if (response.status !== 200) {
                    throw new Error('Failed to fetch user data');
                }

                userData = await response.json();
            }

            settings.githubToken = token;
            settings.githubUsername = userData.login;
            settings.githubAvatar = userData.avatar_url;
            settings.githubLinked = true;
            saveSettings();

            Spicetify.showNotification(`✓ Logged in as ${userData.login}`, false, 3000);

            await verifyRecentVotes();
        } catch (e) {
            console.error('[TrueTunes] OAuth completion error:', e);
            Spicetify.showNotification('❌ Failed to complete authentication', true, 3000);
        }
    }

    function logoutGithub() {
        settings.githubToken = null;
        settings.githubUsername = null;
        settings.githubAvatar = null;
        settings.githubLinked = false;
        votedArtists.clear();
        userStats = { totalVotes: 0, votedArtists: [], lastVerified: null };
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
        } catch (e) {
            console.error('[TrueTunes] Error loading settings:', e);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem('truetunes_settings', JSON.stringify(settings));
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
                    const artistId = artistIdMatch[1];
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

    function hasVoted(artistId) {
        return votedArtists.has(artistId);
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
                        A popup will open for GitHub authentication
                    </p>
                </div>
            `;
        }

        return `
            <div style="padding: 24px;">
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

                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
                    <div style="background: rgba(255, 255, 255, 0.05); padding: 20px; border-radius: 12px; text-align: center;">
                        <div style="font-size: 36px; font-weight: 700; color: #7e22ce; margin-bottom: 8px;">${userStats.totalVotes}</div>
                        <div style="color: #999; font-size: 14px;">Total Votes</div>
                    </div>
                    <div style="background: rgba(255, 255, 255, 0.05); padding: 20px; border-radius: 12px; text-align: center;">
                        <div style="font-size: 36px; font-weight: 700; color: #db2777; margin-bottom: 8px;">${flaggedArtists.size}</div>
                        <div style="color: #999; font-size: 14px;">Flagged Artists</div>
                    </div>
                </div>

                ${userStats.lastVerified ? `
                    <div style="margin-top: 16px; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; font-size: 12px; color: #999; text-align: center;">
                        Last verified: ${new Date(userStats.lastVerified).toLocaleString()}
                    </div>
                ` : ''}
            </div>
        `;
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
            <div style="padding: 24px;">
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
                <div style="max-height: 300px; overflow-y: auto;">
                    ${recentVotes.length > 0 ? recentVotes.map(vote => `
                        <div style="background: rgba(255, 255, 255, 0.05); padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-weight: 600; margin-bottom: 4px;">${vote.artistName}</div>
                                <div style="font-size: 11px; color: #999;">${new Date(vote.createdAt).toLocaleDateString()}</div>
                            </div>
                            <div style="background: ${vote.state === 'open' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 100, 100, 0.2)'}; color: ${vote.state === 'open' ? '#22c55e' : '#999'}; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                                ${vote.state}
                            </div>
                        </div>
                    `).join('') : '<div style="text-align: center; color: #999; padding: 40px;">No votes yet</div>'}
                </div>
            </div>
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

                <label style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(255, 255, 255, 0.05); border-radius: 10px; cursor: pointer;">
                    <input type="checkbox" id="truetunes-setting-dislike" ${settings.autoDislike ? 'checked' : ''} 
                           style="width: 20px; height: 20px; cursor: pointer; accent-color: #7e22ce;">
                    <div>
                        <div style="font-weight: 600; margin-bottom: 4px;">Auto-Remove from Library</div>
                        <div style="font-size: 12px; color: #999;">Automatically remove AI tracks from your library</div>
                    </div>
                </label>

                <div style="margin-top: 24px; padding: 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 10px;">
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

    function createHistoryTab() {
        if (!settings.githubLinked) {
            return `
                <div style="padding: 60px 40px; text-align: center; color: #999;">
                    <div style="font-size: 48px; margin-bottom: 16px;">📜</div>
                    <p>Connect your GitHub account to view your voting history</p>
                </div>
            `;
        }

        return `
            <div style="padding: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 style="font-size: 18px; font-weight: 600;">📜 Voting History</h3>
                    <span style="color: #999; font-size: 14px;">${userStats.votedArtists.length} total votes</span>
                </div>
                
                <div style="max-height: 400px; overflow-y: auto;">
                    ${userStats.votedArtists.length > 0 ? userStats.votedArtists
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .map(vote => `
                        <div style="background: rgba(255, 255, 255, 0.05); padding: 16px; border-radius: 10px; margin-bottom: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; font-size: 16px; margin-bottom: 6px;">${vote.artistName}</div>
                                    <div style="font-size: 12px; color: #999;">
                                        <span>Issue #${vote.issueNumber}</span>
                                        <span style="margin: 0 8px;">•</span>
                                        <span>${new Date(vote.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                        <span style="margin: 0 8px;">•</span>
                                        <span style="color: ${vote.state === 'open' ? '#22c55e' : '#999'};">${vote.state}</span>
                                    </div>
                                </div>
                                <a href="https://github.com/Lewdcifer666/TrueTunes/issues/${vote.issueNumber}" 
                                   target="_blank" 
                                   style="color: #7e22ce; text-decoration: none; font-weight: 600; font-size: 14px;">
                                    View →
                                </a>
                            </div>
                        </div>
                    `).join('') : '<div style="text-align: center; color: #999; padding: 60px 20px;"><div style="font-size: 48px; margin-bottom: 12px;">🎵</div><div>No votes yet. Start reporting AI-generated artists!</div></div>'}
                </div>
            </div>
        `;
    }

    function renderTrueTunesPanel() {
        const panel = document.getElementById('truetunes-panel-content');
        if (!panel) return;

        const tabs = {
            account: createAccountTab(),
            stats: createStatsTab(),
            settings: createSettingsTab(),
            history: createHistoryTab()
        };

        panel.innerHTML = tabs[currentTab];

        // Attach event listeners based on current tab
        if (currentTab === 'account') {
            document.getElementById('truetunes-github-login')?.addEventListener('click', startGithubOAuth);

            document.getElementById('truetunes-logout')?.addEventListener('click', () => {
                if (confirm('Are you sure you want to logout?')) {
                    logoutGithub();
                }
            });
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
            });
            document.getElementById('truetunes-setting-dislike')?.addEventListener('change', (e) => {
                settings.autoDislike = e.target.checked;
                saveSettings();
            });
            document.getElementById('truetunes-verify-now')?.addEventListener('click', async () => {
                Spicetify.showNotification('Verifying votes...', false, 2000);
                await verifyRecentVotes();
                renderTrueTunesPanel();
            });
        }
    }


    async function verifyGithubUsername(username) {
        try {
            const response = await fetch(`https://api.github.com/users/${username}`);
            if (response.status === 200) {
                const data = await response.json();
                return { valid: true, avatar: data.avatar_url, name: data.name || username };
            }
            return { valid: false };
        } catch (e) {
            console.error('[TrueTunes] Error verifying GitHub username:', e);
            return { valid: false };
        }
    }

    function showTrueTunesPanel() {
        // Create modal container
        const modal = document.createElement('div');
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
        panel.style.cssText = `
            background: #121212;
            width: 700px;
            max-width: 90vw;
            height: 600px;
            max-height: 90vh;
            border-radius: 16px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            animation: slideUp 0.3s ease;
            overflow: hidden;
        `;

        // Header with tabs
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

        // Tab navigation
        const tabNav = document.createElement('div');
        tabNav.style.cssText = `
            display: flex;
            background: #1a1a1a;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        `;

        const tabs = [
            { id: 'account', icon: '👤', label: 'Account' },
            { id: 'stats', icon: '📊', label: 'Stats' },
            { id: 'settings', icon: '⚙️', label: 'Settings' },
            { id: 'history', icon: '📜', label: 'History' }
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
                document.getElementById('truetunes-modal')?.remove();
                showTrueTunesPanel();
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

        // Content area
        const content = document.createElement('div');
        content.id = 'truetunes-panel-content';
        content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            color: white;
        `;

        panel.appendChild(header);
        panel.appendChild(tabNav);
        panel.appendChild(content);
        modal.appendChild(panel);

        document.body.appendChild(modal);

        // Close handlers
        document.getElementById('truetunes-close').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        // Render current tab content
        renderTrueTunesPanel();
    }

    function createTrueTunesButton() {
        // Find the top bar (where profile button is)
        const topBar = document.querySelector('.main-topBar-container');
        if (!topBar) {
            setTimeout(createTrueTunesButton, 500);
            return;
        }

        // Check if button already exists
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
            margin-right: 16px;
            box-shadow: 0 4px 12px rgba(126, 34, 206, 0.3);
            transition: all 0.2s;
            position: relative;
        `;

        button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 32 32" fill="white">
                <path d="M16 2C8.3 2 2 8.3 2 16s6.3 14 14 14 14-6.3 14-14S23.7 2 16 2zm0 4c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zM8 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm8 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0-8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm8 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
            </svg>
        `;

        // Notification badge if not linked
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

        // Find the user widget and insert before it
        const userWidget = topBar.querySelector('[data-testid="user-widget-link"]');
        if (userWidget && userWidget.parentElement) {
            userWidget.parentElement.insertBefore(button, userWidget.parentElement.firstChild);
        } else {
            topBar.appendChild(button);
        }

        console.log('[TrueTunes] Button created');
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

            console.log('[TrueTunes] Loaded', flaggedArtists.size, 'flagged artists');

            if (settings.highlightInPlaylists) {
                setTimeout(() => highlightPlaylistItems(), 1000);
            }
        } catch (error) {
            console.error('[TrueTunes] Failed to load list:', error);
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

            if (settings.autoDislike) {
                try {
                    const uri = Spicetify.Player.data.track.uri;
                    Spicetify.Platform.LibraryAPI.remove({ uris: [uri] });
                } catch (error) {
                    console.error('[TrueTunes] Failed to dislike:', error);
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
                }
                
                .truetunes-vote-button {
                    display: inline-flex;
                    margin-left: 12px;
                    margin-right: 8px;
                    opacity: 1;
                    transition: opacity 0.2s;
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

                #truetunes-panel-content::-webkit-scrollbar {
                    width: 8px;
                }

                #truetunes-panel-content::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.05);
                }

                #truetunes-panel-content::-webkit-scrollbar-thumb {
                    background: rgba(126, 34, 206, 0.5);
                    border-radius: 4px;
                }

                #truetunes-panel-content::-webkit-scrollbar-thumb:hover {
                    background: rgba(126, 34, 206, 0.7);
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
            if (!artistId) return;

            const artistName = getArtistNameFromRow(row);
            const alreadyVoted = hasVoted(artistId);

            if (existing) {
                const wasVoted = existing.classList.contains('voted-state');
                if (wasVoted === alreadyVoted) return;
                existing.remove();
            }

            const buttonContainer = row.querySelector('[data-testid="tracklist-row"] > div:last-child') ||
                row.querySelector('.main-trackList-rowSectionEnd');

            if (!buttonContainer) return;

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
            // Silently fail
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
            // Silently fail
        }
    }

    function updateButtonsForArtist(artistId) {
        try {
            const rows = document.querySelectorAll('[data-testid="tracklist-row"], .main-trackList-trackListRow');

            rows.forEach(row => {
                const rowArtistId = getArtistIdFromRow(row);
                if (rowArtistId === artistId) {
                    const existing = row.querySelector('.truetunes-vote-button');
                    if (existing) existing.remove();
                    addVoteButtonToRow(row);
                }
            });
        } catch (e) {
            console.error('[TrueTunes] Error updating buttons:', e);
        }
    }

    function highlightPlaylistItems() {
        if (!settings.highlightInPlaylists || isProcessing) return;

        isProcessing = true;

        try {
            const rows = document.querySelectorAll('[data-testid="tracklist-row"], .main-trackList-trackListRow');

            rows.forEach(row => {
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
                    // Continue
                }
            });
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
            timeout = setTimeout(() => highlightPlaylistItems(), 300);
        };

        const observer = new MutationObserver(debouncedHighlight);

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => highlightPlaylistItems(), 2000);
        setInterval(() => highlightPlaylistItems(), 5000);
    }

    // ===== INITIALIZATION =====

    async function init() {
        if (!Spicetify?.Player) {
            setTimeout(init, 100);
            return;
        }

        console.log('[TrueTunes] Initializing...');

        try {
            loadSettings();
            loadUserStats();
            loadVotedArtists();
            injectStyles();
            await loadFlaggedList();

            if (settings.githubLinked) {
                setTimeout(() => verifyRecentVotes(), 3000);
            }

            Spicetify.Player.addEventListener('songchange', () => {
                checkCurrentTrack();
                setTimeout(() => highlightPlaylistItems(), 500);
            });

            watchPlaylistChanges();
            setInterval(() => loadFlaggedList(), 6 * 60 * 60 * 1000);

            if (settings.githubLinked) {
                setInterval(() => verifyRecentVotes(), settings.verificationInterval);
            }

            createTrueTunesButton();

            console.log('[TrueTunes] Ready!');
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

                        let artistName = "Unknown Artist";
                        try {
                            const item = Spicetify.Player.data?.item;
                            if (item?.artists?.[0]) {
                                artistName = item.artists[0].name;
                            }
                        } catch (e) { }

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

                console.log('[TrueTunes] Context menu registered!');
            } catch (error) {
                console.error('[TrueTunes] Failed to register context menu:', error);
            }
        }, 1000);
    }

    registerContextMenu();
})();