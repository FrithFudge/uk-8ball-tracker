const STORAGE_KEY = 'uk8ball-tracker';
const SYNC_EXPORT_FILENAME = 'uk8ball-tracker-backup.json';

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

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    players: state.players,
    matches: state.matches,
    selectedPlayerId: state.selectedPlayerId,
    filters: state.filters
  }));
}

function portableState() {
  return {
    players: state.players,
    matches: state.matches,
    selectedPlayerId: null,
    filters: { playerId: 'all', from: '', to: '' }
  };
}

function encodeShareCode(data) {
  const json = JSON.stringify(data);
  try {
    return btoa(unescape(encodeURIComponent(json)));
  } catch (err) {
    console.error('Failed to encode share code', err);
    return json;
  }
}

function decodeShareCode(code) {
  try {
    const decoded = atob(code);
    return JSON.parse(decodeURIComponent(escape(decoded)));
  } catch (err) {
    try {
      return JSON.parse(code);
    } catch (inner) {
      throw err;
    }
  }
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

  elements.exportData = $('#exportData');
  elements.importData = $('#importData');
  elements.importFile = $('#importFile');
  elements.shareCode = $('#shareCode');
  elements.copyShare = $('#copyShare');
  elements.importShare = $('#importShare');
  elements.syncStatus = $('#syncStatus');

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
  persistState();
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
  persistState();
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

function applyImportedData(data) {
  state.players = data.players || [];
  state.matches = data.matches || [];
  state.selectedPlayerId = null;
  state.filters = { playerId: 'all', from: '', to: '' };
  persistState();
  render();
}

function updateShareCodeField() {
  if (!elements.shareCode) return;
  const code = encodeShareCode(portableState());
  elements.shareCode.value = code;
}

function setSyncStatus(message, isError = false) {
  if (!elements.syncStatus) return;
  elements.syncStatus.textContent = message;
  elements.syncStatus.style.color = isError ? 'var(--danger)' : 'var(--primary)';
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
  persistState();
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

function exportData() {
  const data = portableState();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = SYNC_EXPORT_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
  setSyncStatus('Backup downloaded. Import it on another device to sync.');
}

function importFromFile() {
  const file = elements.importFile?.files?.[0];
  if (!file) {
    setSyncStatus('Select a backup file first.', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const validation = validateImportedData(data);
      if (validation) {
        setSyncStatus(validation, true);
        return;
      }
      applyImportedData(data);
      setSyncStatus('Backup imported successfully.');
    } catch (err) {
      setSyncStatus('Could not read backup file.', true);
    }
  };
  reader.readAsText(file);
}

function importFromShare() {
  const code = elements.shareCode?.value.trim();
  if (!code) {
    setSyncStatus('Paste a share code to import.', true);
    return;
  }
  try {
    const data = decodeShareCode(code);
    const validation = validateImportedData(data);
    if (validation) {
      setSyncStatus(validation, true);
      return;
    }
    applyImportedData(data);
    setSyncStatus('Share code imported successfully.');
  } catch (err) {
    setSyncStatus('Invalid share code.', true);
  }
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
    persistState();
    render();
  });

  elements.resetData.addEventListener('click', clearAllData);

  elements.exportData?.addEventListener('click', exportData);
  elements.importData?.addEventListener('click', importFromFile);
  elements.copyShare?.addEventListener('click', async () => {
    if (!elements.shareCode) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(elements.shareCode.value);
      } else {
        elements.shareCode.select();
        document.execCommand('copy');
      }
      setSyncStatus('Share code copied. Paste it on another device.');
    } catch (err) {
      setSyncStatus('Could not copy share code.', true);
    }
  });
  elements.importShare?.addEventListener('click', importFromShare);
}

function render() {
  renderPlayers();
  renderMatches();
  renderStats();
  updateMatchFormAvailability();
  elements.filterFrom.value = state.filters.from || '';
  elements.filterTo.value = state.filters.to || '';
  updateShareCodeField();
}

document.addEventListener('DOMContentLoaded', () => {
  initElements();
  loadState();
  attachEvents();
  render();
});
