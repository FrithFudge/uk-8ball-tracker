const STORAGE_KEY = 'uk8ball-tracker';
const GH_CONFIG_KEY = 'uk8ball-tracker-github';
const AUTH_KEY = 'uk8ball-auth';

const state = {
  players: [],
  matches: [],
  selectedPlayerId: null,
  filters: {
    playerId: 'all',
    from: '',
    to: ''
  }
};

const gitHubSync = {
  config: {
    owner: '',
    repo: '',
    branch: 'main',
    path: 'data/league.json',
    token: ''
  },
  lastSha: null,
  isSyncing: false,
  pendingPush: null
};

const authState = {
  passcode: '',
  token: '',
  isLoggedIn: false,
  passcodeSet: false
};

function deriveSiteRepo() {
  const host = window.location.hostname;
  const path = window.location.pathname.split('/').filter(Boolean);
  if (!host.endsWith('github.io')) return null;
  const owner = host.replace('.github.io', '');
  const repo = path[0] || `${owner}.github.io`;
  return { owner, repo };
}

const $ = (selector) => document.querySelector(selector);

const elements = {};

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.players = parsed.players || [];
    state.matches = parsed.matches || [];
    state.selectedPlayerId = parsed.selectedPlayerId || null;
    state.filters = parsed.filters || state.filters;
  } catch (err) {
    console.error('Failed to parse saved data', err);
  }
}

function loadAuth() {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    authState.passcode = parsed.passcode || '';
    authState.passcodeSet = !!parsed.passcode;
    authState.token = parsed.token || '';
  } catch (err) {
    console.error('Failed to parse auth state', err);
  }
}

function loadGitHubConfig() {
  const raw = localStorage.getItem(GH_CONFIG_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    gitHubSync.config = { ...gitHubSync.config, token: parsed.token || '', path: parsed.path || 'data/league.json', branch: parsed.branch || 'main' };
    gitHubSync.lastSha = parsed.lastSha || null;
  } catch (err) {
    console.error('Failed to parse GitHub config', err);
  }
}

function schedulePush(reason = 'Update league data') {
  if (!deriveSiteRepo()) {
    setSyncStatus('Open this on GitHub Pages to enable auto-sync.', true);
    return;
  }
  if (!authState.isLoggedIn) {
    setSyncStatus('Login with the team passcode to enable sync.', true);
    return;
  }
  if (!gitHubSync.config.token) {
    setSyncStatus('Add a GitHub token to sync changes for everyone.', true);
    return;
  }
  if (gitHubSync.pendingPush) clearTimeout(gitHubSync.pendingPush);
  gitHubSync.pendingPush = setTimeout(() => pushToGitHub(reason), 1200);
}

function persistState(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    players: state.players,
    matches: state.matches,
    selectedPlayerId: state.selectedPlayerId,
    filters: state.filters
  }));
  if (!options.skipSync) schedulePush(options.reason || 'Autosave');
}

function persistAuth() {
  localStorage.setItem(AUTH_KEY, JSON.stringify({
    passcode: authState.passcode,
    token: authState.token
  }));
}

function persistGitHubConfig() {
  const payload = { token: gitHubSync.config.token, path: gitHubSync.config.path, branch: gitHubSync.config.branch, lastSha: gitHubSync.lastSha };
  localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(payload));
}

function portableState() {
  return {
    players: state.players,
    matches: state.matches,
    selectedPlayerId: null,
    filters: { playerId: 'all', from: '', to: '' }
  };
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(16) + Math.random().toString(16).slice(2);
}

function initElements() {
  elements.playerForm = $('#playerForm');
  elements.playerName = $('#playerName');
  elements.playerNickname = $('#playerNickname');
  elements.addPlayer = $('#addPlayer');
  elements.playerCount = $('#playerCount');
  elements.duplicateWarning = $('#duplicateWarning');
  elements.playerList = $('#playerList');

  elements.loginPasscode = $('#loginPasscode');
  elements.loginToken = $('#loginToken');
  elements.loginBtn = $('#loginBtn');
  elements.loginMessage = $('#loginMessage');

  elements.ghToken = $('#ghToken');
  elements.ghRefresh = $('#ghRefresh');
  elements.syncStatus = $('#syncStatus');
  elements.siteRepoDisplay = $('#siteRepoDisplay');

  elements.matchForm = $('#matchForm');
  elements.playerA = $('#playerA');
  elements.playerB = $('#playerB');
  elements.raceTo = $('#raceTo');
  elements.framesA = $('#framesA');
  elements.framesB = $('#framesB');
  elements.outcome = $('#outcome');
  elements.note = $('#note');
  elements.matchMessage = $('#matchMessage');
  elements.saveMatch = $('#saveMatch');

  elements.filterPlayer = $('#filterPlayer');
  elements.filterFrom = $('#filterFrom');
  elements.filterTo = $('#filterTo');
  elements.clearFilters = $('#clearFilters');
  elements.matchHistory = $('#matchHistory');

  elements.statsPanel = $('#statsPanel');

  elements.clearMatches = $('#clearMatches');
  elements.resetData = $('#resetData');
}

function updatePlayerCount() {
  elements.playerCount.textContent = `${state.players.filter(p => p.active !== false).length} / 20 players`;
  elements.addPlayer.disabled = state.players.filter(p => p.active !== false).length >= 20;
}

function addPlayer(name, nickname) {
  const exists = state.players.some(p => p.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    elements.duplicateWarning.textContent = 'That player name already exists.';
    return false;
  }
  const player = { id: uid(), name: name.trim(), nickname: nickname.trim(), active: true, createdAt: new Date().toISOString() };
  state.players.push(player);
  persistState({ reason: 'Add player' });
  render();
  elements.playerForm.reset();
  elements.duplicateWarning.textContent = '';
  return true;
}

function deletePlayer(id) {
  const playerMatches = state.matches.some(m => m.playerAId === id || m.playerBId === id);
  const player = state.players.find(p => p.id === id);
  if (!player) return;

  if (playerMatches) {
    if (!confirm('This player has recorded matches. Archive the player (keeps past results but hides from selection)?')) return;
    player.active = false;
    player.archivedAt = new Date().toISOString();
  } else {
    if (!confirm('Delete player permanently?')) return;
    state.players = state.players.filter(p => p.id !== id);
  }

  if (state.selectedPlayerId === id) state.selectedPlayerId = null;
  persistState({ reason: 'Delete/archive player' });
  render();
}

function buildPlayerOptions(selectEl, includeAll = false) {
  selectEl.innerHTML = '';
  if (includeAll) {
    const opt = document.createElement('option');
    opt.value = 'all';
    opt.textContent = 'All players';
    selectEl.appendChild(opt);
  }
  const activePlayers = state.players.filter(p => p.active !== false);
  activePlayers.forEach(player => {
    const opt = document.createElement('option');
    opt.value = player.id;
    opt.textContent = player.nickname ? `${player.name} (${player.nickname})` : player.name;
    selectEl.appendChild(opt);
  });
}

function renderPlayers() {
  const template = document.getElementById('playerTableTemplate');
  const clone = template.content.cloneNode(true);
  const tbody = clone.querySelector('tbody');
  const statsMap = calculateAllStats();

  if (!state.players.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No players added yet.';
    elements.playerList.innerHTML = '';
    elements.playerList.appendChild(empty);
    updatePlayerCount();
    buildPlayerOptions(elements.playerA);
    buildPlayerOptions(elements.playerB);
    buildPlayerOptions(elements.filterPlayer, true);
    return;
  }

  const sortedPlayers = [...state.players].sort((a, b) => a.name.localeCompare(b.name));
  sortedPlayers.forEach(player => {
    const row = document.createElement('tr');
    const stats = statsMap[player.id] || defaultStats();
    const nameCell = document.createElement('td');
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.textContent = player.name + (player.nickname ? ` (${player.nickname})` : '');
    if (player.active === false) {
      const badge = document.createElement('span');
      badge.className = 'badge note';
      badge.textContent = 'Archived';
      chip.appendChild(badge);
    }
    nameCell.appendChild(chip);
    nameCell.title = 'View stats';
    nameCell.style.cursor = 'pointer';
    nameCell.addEventListener('click', () => {
      state.selectedPlayerId = player.id;
      persistState();
      renderStats();
    });

    const matchesCell = document.createElement('td');
    matchesCell.textContent = stats.matches;

    const winsCell = document.createElement('td');
    winsCell.innerHTML = `<span class="badge win">${stats.wins}</span>`;

    const lossesCell = document.createElement('td');
    lossesCell.innerHTML = `<span class="badge loss">${stats.losses}</span>`;

    const winPctCell = document.createElement('td');
    winPctCell.textContent = stats.matches ? `${stats.winPct}%` : '—';

    const actionCell = document.createElement('td');
    actionCell.style.textAlign = 'right';
    const viewBtn = document.createElement('button');
    viewBtn.className = 'ghost';
    viewBtn.textContent = 'View stats';
    viewBtn.addEventListener('click', () => {
      state.selectedPlayerId = player.id;
      persistState();
      renderStats();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger ghost';
    deleteBtn.textContent = player.active === false ? 'Remove' : 'Delete';
    deleteBtn.addEventListener('click', () => deletePlayer(player.id));

    const actionWrap = document.createElement('div');
    actionWrap.style.display = 'flex';
    actionWrap.style.gap = '8px';
    actionWrap.appendChild(viewBtn);
    actionWrap.appendChild(deleteBtn);
    actionCell.appendChild(actionWrap);

    row.appendChild(nameCell);
    row.appendChild(matchesCell);
    row.appendChild(winsCell);
    row.appendChild(lossesCell);
    row.appendChild(winPctCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });

  elements.playerList.innerHTML = '';
  elements.playerList.appendChild(clone);
  updatePlayerCount();
  buildPlayerOptions(elements.playerA);
  buildPlayerOptions(elements.playerB);
  buildPlayerOptions(elements.filterPlayer, true);
  elements.filterPlayer.value = state.filters.playerId || 'all';
}

function defaultStats() {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    framesFor: 0,
    framesAgainst: 0,
    outcomeWins: {},
    outcomeLosses: {},
    headToHead: {}
  };
}

function validateImportedData(data) {
  if (!data || typeof data !== 'object') return 'Invalid backup format.';
  if (!Array.isArray(data.players) || !Array.isArray(data.matches)) return 'Backup must include players and matches arrays.';
  if (data.players.length > 20) return 'Backup contains more than 20 players.';
  const ids = new Set();
  for (const player of data.players) {
    if (!player.id || ids.has(player.id)) return 'Player IDs must be unique.';
    ids.add(player.id);
  }
  const validMatches = data.matches.filter(m => ids.has(m.playerAId) && ids.has(m.playerBId));
  if (validMatches.length !== data.matches.length) {
    data.matches = validMatches;
  }
  return '';
}

function applyImportedData(data, options = {}) {
  state.players = data.players || [];
  state.matches = data.matches || [];
  state.selectedPlayerId = null;
  state.filters = { playerId: 'all', from: '', to: '' };
  persistState({ skipSync: options.skipSync, reason: options.reason });
  render();
}

function setSyncStatus(message, isError = false) {
  if (!elements.syncStatus) return;
  elements.syncStatus.textContent = message;
  elements.syncStatus.style.color = isError ? 'var(--danger)' : 'var(--primary)';
}

function setLoginMessage(message, isError = false) {
  if (!elements.loginMessage) return;
  elements.loginMessage.textContent = message;
  elements.loginMessage.style.color = isError ? 'var(--danger)' : 'var(--primary)';
}

function populateGitHubFields() {
  if (!elements.ghToken) return;
  elements.ghToken.value = authState.isLoggedIn ? gitHubSync.config.token : '';
  elements.ghToken.disabled = !authState.isLoggedIn;
  elements.ghToken.placeholder = authState.isLoggedIn ? 'ghp_...' : 'Login to unlock token';
  if (elements.siteRepoDisplay) {
    const derived = deriveSiteRepo();
    if (derived) {
      elements.siteRepoDisplay.textContent = `Using this site's repo: ${derived.owner}/${derived.repo}`;
    } else {
      elements.siteRepoDisplay.textContent = 'Open this on GitHub Pages to sync via the site repo.';
    }
  }
}

function applySiteRepoDefaults(showStatus = false) {
  const derived = deriveSiteRepo();
  if (!derived) {
    if (showStatus && elements.syncStatus) {
      setSyncStatus('Open this on GitHub Pages to sync with its repo.', true);
    }
    return;
  }
  gitHubSync.config.owner = derived.owner;
  gitHubSync.config.repo = derived.repo;
  if (!gitHubSync.config.path) { gitHubSync.config.path = 'data/league.json'; }
  persistGitHubConfig();
  populateGitHubFields();
  if (showStatus || elements.syncStatus.textContent === 'Waiting to sync…') {
    setSyncStatus(`Ready to sync via ${gitHubSync.config.owner}/${gitHubSync.config.repo}`);
  }
}

function readGitHubFields() {
  if (!authState.isLoggedIn) {
    setSyncStatus('Login first to save the repo token.', true);
    populateGitHubFields();
    return;
  }
  gitHubSync.config.token = elements.ghToken.value.trim();
  persistGitHubConfig();
}

function secureTokenFromConfig() {
  if (!authState.token && gitHubSync.config.token) {
    authState.token = gitHubSync.config.token;
    persistAuth();
  }
  if (!authState.isLoggedIn) {
    gitHubSync.config.token = '';
  } else if (authState.token) {
    gitHubSync.config.token = authState.token;
  }
  persistGitHubConfig();
}

function updateLoginUI() {
  if (!elements.loginBtn) return;
  elements.loginToken.disabled = false;
  elements.loginPasscode.placeholder = authState.passcodeSet ? 'Enter team passcode' : 'Set a team passcode';
  elements.loginBtn.textContent = authState.passcodeSet ? 'Login / Update token' : 'Create passcode & save token';
  if (!authState.isLoggedIn) {
    setLoginMessage(authState.passcodeSet ? 'Enter the passcode to unlock sync.' : 'Set a passcode and token to start syncing.');
  }
  if (authState.isLoggedIn) {
    setLoginMessage(authState.token ? 'Logged in. Token stored locally for sync.' : 'Logged in. Add a token to enable sync.');
    if (authState.token && elements.loginToken && !elements.loginToken.value) {
      elements.loginToken.placeholder = 'Token stored locally';
    }
  }
  populateGitHubFields();
}

function handleLogin() {
  const passcode = elements.loginPasscode.value.trim();
  const tokenInput = elements.loginToken.value.trim();
  if (!passcode) {
    setLoginMessage('Enter the team passcode to continue.', true);
    return;
  }
  if (!authState.passcodeSet) {
    authState.passcode = passcode;
    authState.passcodeSet = true;
  } else if (authState.passcode !== passcode) {
    setLoginMessage('Incorrect passcode.', true);
    return;
  }

  if (tokenInput) {
    authState.token = tokenInput;
    gitHubSync.config.token = tokenInput;
    persistGitHubConfig();
  } else if (authState.token) {
    gitHubSync.config.token = authState.token;
  }

  authState.isLoggedIn = true;
  persistAuth();
  setLoginMessage(authState.token ? 'Logged in. Token stored locally for sync.' : 'Logged in. Add a token to enable sync.', !authState.token);
  populateGitHubFields();
  if (authState.token) {
    setSyncStatus('Ready to sync with stored token.');
    schedulePush('Login sync');
  } else {
    setSyncStatus('Login saved. Add a token to sync.', true);
  }
}

function validateGitHubConfig() {
  const derived = deriveSiteRepo();
  if (!derived) return 'Open this app from GitHub Pages to sync with the site repo.';
  gitHubSync.config.owner = derived.owner;
  gitHubSync.config.repo = derived.repo;
  if (!gitHubSync.config.path.endsWith('.json')) return 'Path should point to a JSON file.';
  return '';
}

function encodeToBase64(data) {
  return btoa(unescape(encodeURIComponent(data)));
}

function decodeBase64(content) {
  return decodeURIComponent(escape(atob(content)));
}

async function loadFromGitHub(options = {}) {
  const validation = validateGitHubConfig();
  if (validation) {
    if (!options.silent) setSyncStatus(validation, true);
    return;
  }
  const { owner, repo, branch, path, token } = gitHubSync.config;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  gitHubSync.isSyncing = true;
  if (!options.silent) setSyncStatus('Loading from GitHub...');
  try {
    const res = await fetch(url, { headers });
    if (res.status === 404) {
      gitHubSync.lastSha = null;
      persistGitHubConfig();
      if (!options.silent) setSyncStatus('File not found on GitHub. Data will sync after the next save.', true);
      return;
    }
    if (!res.ok) {
      throw new Error(`GitHub responded with ${res.status}`);
    }
    const json = await res.json();
    if (!json.content) {
      throw new Error('No content at path.');
    }
    const decoded = JSON.parse(decodeBase64(json.content));
    const validationMessage = validateImportedData(decoded);
    if (validationMessage) {
      if (!options.silent) setSyncStatus(validationMessage, true);
      return;
    }
    applyImportedData(decoded, { skipSync: true, reason: 'Sync pull' });
    gitHubSync.lastSha = json.sha || null;
    persistGitHubConfig();
    if (!options.silent) setSyncStatus('Loaded data from GitHub.');
  } catch (err) {
    console.error(err);
    if (!options.silent) setSyncStatus('Could not load from GitHub. Check token/repo/path.', true);
  } finally {
    gitHubSync.isSyncing = false;
  }
}

async function pushToGitHub(reason = 'Update league data') {
  const validation = validateGitHubConfig();
  if (validation) {
    setSyncStatus(validation, true);
    return false;
  }
  const { owner, repo, branch, path, token } = gitHubSync.config;
  if (!token) {
    setSyncStatus('GitHub token required to push changes.', true);
    return false;
  }
  if (gitHubSync.pendingPush) {
    clearTimeout(gitHubSync.pendingPush);
    gitHubSync.pendingPush = null;
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  gitHubSync.isSyncing = true;
  setSyncStatus('Pushing to GitHub...');
  try {
    if (!gitHubSync.lastSha) {
      const check = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
      if (check.ok) {
        const existing = await check.json();
        gitHubSync.lastSha = existing.sha || null;
      }
    }
    const content = encodeToBase64(JSON.stringify(portableState(), null, 2));
    const body = {
      message: `${reason} (${new Date().toLocaleString()})`,
      content,
      branch
    };
    if (gitHubSync.lastSha) body.sha = gitHubSync.lastSha;
    const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      if (res.status === 409) {
        setSyncStatus('GitHub file changed. Load latest before pushing again.', true);
        gitHubSync.lastSha = null;
        persistGitHubConfig();
        return false;
      }
      throw new Error(`GitHub responded with ${res.status}`);
    }
    const json = await res.json();
    gitHubSync.lastSha = json.content?.sha || null;
    persistGitHubConfig();
    setSyncStatus('Pushed data to GitHub.');
    return true;
  } catch (err) {
    console.error(err);
    setSyncStatus('Could not push to GitHub. Check token/repo permissions.', true);
    return false;
  } finally {
    gitHubSync.isSyncing = false;
  }
}

function calculateAllStats() {
  const statsMap = {};
  state.players.forEach(p => { statsMap[p.id] = defaultStats(); });

  state.matches.forEach(match => {
    const aStats = statsMap[match.playerAId] || defaultStats();
    const bStats = statsMap[match.playerBId] || defaultStats();

    aStats.matches += 1;
    bStats.matches += 1;

    aStats.framesFor += Number(match.framesA);
    aStats.framesAgainst += Number(match.framesB);
    bStats.framesFor += Number(match.framesB);
    bStats.framesAgainst += Number(match.framesA);

    const winnerStats = statsMap[match.winnerId];
    const loserStats = match.winnerId === match.playerAId ? bStats : aStats;
    winnerStats.wins += 1;
    loserStats.losses += 1;

    winnerStats.outcomeWins[match.outcome] = (winnerStats.outcomeWins[match.outcome] || 0) + 1;
    loserStats.outcomeLosses[match.outcome] = (loserStats.outcomeLosses[match.outcome] || 0) + 1;

    // Head to head
    const opponentForA = statsMap[match.playerAId].headToHead;
    const opponentForB = statsMap[match.playerBId].headToHead;
    opponentForA[match.playerBId] = opponentForA[match.playerBId] || { wins: 0, losses: 0 };
    opponentForB[match.playerAId] = opponentForB[match.playerAId] || { wins: 0, losses: 0 };
    if (match.winnerId === match.playerAId) {
      opponentForA[match.playerBId].wins += 1;
      opponentForB[match.playerAId].losses += 1;
    } else {
      opponentForA[match.playerBId].losses += 1;
      opponentForB[match.playerAId].wins += 1;
    }
  });

  Object.values(statsMap).forEach(stats => {
    stats.winPct = stats.matches ? Math.round((stats.wins / stats.matches) * 100) : 0;
    stats.frameDiff = stats.framesFor - stats.framesAgainst;
  });
  return statsMap;
}

function validateMatch({ playerAId, playerBId, raceTo, framesA, framesB }) {
  if (!playerAId || !playerBId) return 'Please choose two players.';
  if (playerAId === playerBId) return 'Please choose two different players.';
  if (raceTo < 1 || raceTo > 9) return 'Race to must be between 1 and 9 frames.';
  if (framesA < 0 || framesB < 0) return 'Frame scores cannot be negative.';
  if (framesA > 9 || framesB > 9) return 'Frames cannot exceed 9 for quick entry.';
  const winningA = framesA === raceTo && framesB < raceTo;
  const winningB = framesB === raceTo && framesA < raceTo;
  if (!winningA && !winningB) return 'One player must reach the race-to value, the other must be lower.';
  return '';
}

function saveMatch(data) {
  const validation = validateMatch(data);
  if (validation) {
    elements.matchMessage.textContent = validation;
    elements.matchMessage.style.color = 'var(--danger)';
    return;
  }
  const winnerId = data.framesA > data.framesB ? data.playerAId : data.playerBId;
  const match = {
    id: uid(),
    date: new Date().toISOString(),
    playerAId: data.playerAId,
    playerBId: data.playerBId,
    raceTo: data.raceTo,
    framesA: data.framesA,
    framesB: data.framesB,
    outcome: data.outcome,
    note: data.note,
    breaker: data.breaker,
    winnerId
  };
  state.matches.unshift(match);
  elements.matchForm.reset();
  elements.matchMessage.textContent = 'Match saved!';
  elements.matchMessage.style.color = 'var(--primary)';
  persistState({ reason: 'Record match' });
  render();
}

function renderMatches() {
  const template = document.getElementById('matchHistoryTemplate');
  const clone = template.content.cloneNode(true);
  const tbody = clone.querySelector('tbody');

  const filtered = state.matches.filter(match => {
    if (state.filters.playerId !== 'all') {
      if (match.playerAId !== state.filters.playerId && match.playerBId !== state.filters.playerId) return false;
    }
    if (state.filters.from) {
      if (new Date(match.date) < new Date(state.filters.from)) return false;
    }
    if (state.filters.to) {
      const toDate = new Date(state.filters.to);
      toDate.setHours(23, 59, 59, 999);
      if (new Date(match.date) > toDate) return false;
    }
    return true;
  });

  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = state.matches.length ? 'No matches match this filter.' : 'No matches recorded yet.';
    elements.matchHistory.innerHTML = '';
    elements.matchHistory.appendChild(empty);
    return;
  }

  filtered.forEach(match => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = new Date(match.date).toLocaleString();

    const playerA = getPlayerName(match.playerAId);
    const playerB = getPlayerName(match.playerBId);
    const fixtureCell = document.createElement('td');
    fixtureCell.innerHTML = `<strong>${playerA}</strong> vs <strong>${playerB}</strong>`;
    if (match.breaker === 'A') {
      fixtureCell.innerHTML += ' <span class="badge note">A broke</span>';
    } else if (match.breaker === 'B') {
      fixtureCell.innerHTML += ' <span class="badge note">B broke</span>';
    }

    const scoreCell = document.createElement('td');
    const winnerA = match.winnerId === match.playerAId;
    const scoreHTML = `
      <span class="badge ${winnerA ? 'win' : 'loss'}">${match.framesA}</span>
      —
      <span class="badge ${!winnerA ? 'win' : 'loss'}">${match.framesB}</span>
    `;
    scoreCell.innerHTML = scoreHTML;

    const outcomeCell = document.createElement('td');
    const noteText = [match.outcome, match.note].filter(Boolean).join(' · ');
    outcomeCell.textContent = noteText || '—';

    row.appendChild(dateCell);
    row.appendChild(fixtureCell);
    row.appendChild(scoreCell);
    row.appendChild(outcomeCell);
    tbody.appendChild(row);
  });

  elements.matchHistory.innerHTML = '';
  elements.matchHistory.appendChild(clone);
}

function getPlayerName(id) {
  const player = state.players.find(p => p.id === id);
  if (!player) return 'Deleted player';
  let label = player.name;
  if (player.nickname) label += ` (${player.nickname})`;
  if (player.active === false) label += ' (archived)';
  return label;
}

function renderStats() {
  if (!state.selectedPlayerId) {
    elements.statsPanel.textContent = 'No player selected.';
    return;
  }
  const player = state.players.find(p => p.id === state.selectedPlayerId);
  if (!player) {
    elements.statsPanel.textContent = 'Player not found.';
    return;
  }
  const statsMap = calculateAllStats();
  const stats = statsMap[player.id] || defaultStats();
  const mostCommonWin = Object.entries(stats.outcomeWins).sort((a, b) => b[1] - a[1])[0];
  const favouriteWin = mostCommonWin ? `${mostCommonWin[0]} (${mostCommonWin[1]})` : '—';

  const panel = document.createElement('div');
  panel.className = 'stats-panel';

  const header = document.createElement('div');
  header.innerHTML = `<div class="headline">${player.name}${player.nickname ? ` (${player.nickname})` : ''}</div>`;
  if (player.active === false) {
    const archived = document.createElement('span');
    archived.className = 'badge note';
    archived.textContent = 'Archived';
    archived.style.marginLeft = '8px';
    header.appendChild(archived);
  }
  panel.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'stats-grid';
  const pairs = [
    ['Matches', stats.matches],
    ['Wins', stats.wins],
    ['Losses', stats.losses],
    ['Win %', stats.matches ? `${stats.winPct}%` : '—'],
    ['Frames For', stats.framesFor],
    ['Frames Against', stats.framesAgainst],
    ['Frame Diff', stats.frameDiff],
    ['Fav. win note', favouriteWin]
  ];
  pairs.forEach(([title, value]) => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<div class="stat-title">${title}</div><div class="stat-value">${value}</div>`;
    grid.appendChild(card);
  });
  panel.appendChild(grid);

  const headWrap = document.createElement('div');
  headWrap.className = 'head-to-head';
  headWrap.innerHTML = '<div class="stat-title">Head-to-head</div>';
  const opponents = Object.entries(stats.headToHead);
  if (!opponents.length) {
    const none = document.createElement('p');
    none.className = 'muted';
    none.textContent = 'No matches yet.';
    headWrap.appendChild(none);
  } else {
    opponents.sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses));
    opponents.forEach(([opponentId, record]) => {
      const line = document.createElement('div');
      const name = getPlayerName(opponentId);
      line.innerHTML = `<strong>${name}</strong>: ${record.wins}–${record.losses}`;
      headWrap.appendChild(line);
    });
  }
  panel.appendChild(headWrap);

  elements.statsPanel.innerHTML = '';
  elements.statsPanel.appendChild(panel);
}

function updateMatchFormAvailability() {
  const activePlayers = state.players.filter(p => p.active !== false);
  const enoughPlayers = activePlayers.length >= 2;
  [elements.playerA, elements.playerB, elements.raceTo, elements.framesA, elements.framesB, elements.outcome, elements.note, elements.saveMatch]
    .forEach(el => { if (el) el.disabled = !enoughPlayers; });
  if (!enoughPlayers) {
    elements.matchMessage.textContent = 'Add at least two players to record a match.';
    elements.matchMessage.style.color = 'var(--warning)';
  } else {
    elements.matchMessage.textContent = '';
  }
}

function clearAllData() {
  if (!confirm('Reset all players and matches? This cannot be undone.')) return;
  state.players = [];
  state.matches = [];
  state.selectedPlayerId = null;
  localStorage.removeItem(STORAGE_KEY);
  render();
  schedulePush('Reset data');
}

function attachEvents() {
  elements.playerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = elements.playerName.value.trim();
    const nickname = elements.playerNickname.value.trim();
    if (!name) return;
    if (state.players.filter(p => p.active !== false).length >= 20) return;
    addPlayer(name, nickname);
  });

  elements.matchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(elements.matchForm);
    const payload = {
      playerAId: elements.playerA.value,
      playerBId: elements.playerB.value,
      raceTo: Number(elements.raceTo.value),
      framesA: Number(elements.framesA.value),
      framesB: Number(elements.framesB.value),
      outcome: elements.outcome.value,
      note: elements.note.value.trim(),
      breaker: formData.get('breaker') || ''
    };
    saveMatch(payload);
  });

  elements.filterPlayer.addEventListener('change', () => {
    state.filters.playerId = elements.filterPlayer.value;
    persistState();
    renderMatches();
  });
  elements.filterFrom.addEventListener('change', () => {
    state.filters.from = elements.filterFrom.value;
    persistState();
    renderMatches();
  });
  elements.filterTo.addEventListener('change', () => {
    state.filters.to = elements.filterTo.value;
    persistState();
    renderMatches();
  });
  elements.clearFilters.addEventListener('click', () => {
    state.filters = { playerId: 'all', from: '', to: '' };
    persistState();
    render();
  });

  elements.clearMatches.addEventListener('click', () => {
    if (!state.matches.length) return;
    if (!confirm('Clear all recorded matches?')) return;
    state.matches = [];
    persistState({ reason: 'Clear matches' });
    render();
  });

  elements.resetData.addEventListener('click', clearAllData);

  elements.loginBtn.addEventListener('click', handleLogin);
  ['keypress'].forEach(evt => {
    elements.loginPasscode.addEventListener(evt, (e) => {
      if (e.key === 'Enter') handleLogin();
    });
    elements.loginToken.addEventListener(evt, (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  });

  ['input', 'change'].forEach(evt => {
    elements.ghToken.addEventListener(evt, () => {
      readGitHubFields();
      setSyncStatus('Token saved locally. Changes will auto-sync.', false);
    });
  });
  elements.ghRefresh.addEventListener('click', () => loadFromGitHub({ silent: false }));
}

function render() {
  renderPlayers();
  renderMatches();
  renderStats();
  updateMatchFormAvailability();
  elements.filterFrom.value = state.filters.from || '';
  elements.filterTo.value = state.filters.to || '';
}

document.addEventListener('DOMContentLoaded', () => {
  initElements();
  loadState();
  loadAuth();
  loadGitHubConfig();
  secureTokenFromConfig();
  applySiteRepoDefaults();
  populateGitHubFields();
  updateLoginUI();
  attachEvents();
  render();
  loadFromGitHub({ silent: true });
});
