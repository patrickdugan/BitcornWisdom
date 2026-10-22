import {
  THEME_IDS, THEME_NAMES, MARKET_NAMES, MARKET_PRESETS, marketKey,
  symbolLabel, normalTheme, normalizedMarket, sanitizeFavorites,
  toggleFavorite, isFavorite, searchPalette
} from './workspace.js';

export function mountWorkspace({ settings, chart, persist, loadMarket, validateSelection, setIndicator,
  setDrawingTool, onThemeChange = () => {}, onSetLayout = () => {},
  onToggleTimeLink = () => {}, onToggleCursorLink = () => {} }) {
  const el = (id) => document.getElementById(id);
  const root = document.documentElement;
  const workspace = document.querySelector('.workspace');
  const dialog = el('command-dialog');
  const resultsNode = el('command-results');
  const searchField = el('command-search');
  const status = el('workspace-toast');
  let favoritesTab = 'starred';
  let selectedIndex = 0;
  let results = [];
  let toastTimer;
  const started = Date.now();

  function toast(message) {
    status.textContent = message;
    status.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { status.hidden = true; }, 2400);
  }

  function currentMarket() {
    return { market: settings.market, symbol: settings.symbol };
  }

  function favoriteAction(market = currentMarket()) {
    const before = isFavorite(settings.favorites, market);
    settings.favorites = toggleFavorite(settings.favorites, market);
    persist();
    refresh();
    toast((before ? 'Removed from' : 'Added to') + ' favorites · ' + symbolLabel(market.symbol));
  }

  function updateTheme(theme) {
    settings.theme = normalTheme(theme);
    root.dataset.theme = settings.theme;
    el('theme-select').value = settings.theme;
    chart.setOptions({ theme: settings.theme });
    onThemeChange(settings.theme);
    persist();
    refresh();
  }

  function changeMarket(selected) {
    const market = normalizedMarket(selected);
    if (!market) return toast('Invalid market or symbol');
    let interval = settings.interval;
    try { validateSelection(market.market, market.symbol, interval); }
    catch { interval = '5m'; }
    try { validateSelection(market.market, market.symbol, interval); }
    catch { return toast('Market is unavailable for this venue'); }
    const unchanged = settings.market === market.market &&
      settings.symbol === market.symbol && settings.interval === interval;
    settings.market = market.market;
    settings.symbol = market.symbol;
    settings.interval = interval;
    if (!unchanged) loadMarket();
    refresh();
    if (window.matchMedia('(max-width:1110px)').matches) {
      settings.watchlistVisible = false;
      updateLayout();
    }
  }

  function renderWatchlist() {
    const items = favoritesTab === 'starred' ?
      sanitizeFavorites(settings.favorites) : MARKET_PRESETS;
    const filter = el('watchlist-filter').value.trim().toLowerCase();
    const filtered = items.filter((item) =>
      (symbolLabel(item.symbol) + ' ' + MARKET_NAMES[item.market] + ' ' +
       item.symbol).toLowerCase().includes(filter));
    el('watchlist-total').textContent = String(items.length).padStart(2, '0');
    const holder = el('watchlist-items');
    holder.replaceChildren();
    if (!filtered.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'watchlist-empty';
      placeholder.textContent = filter ? 'No matching markets.' :
        'Your favorite markets live here. Browse Discover or star the current pair.';
      holder.append(placeholder);
    }
    const fragment = document.createDocumentFragment();
    for (const item of filtered) {
      const active = item.market === settings.market && item.symbol === settings.symbol;
      const pinned = isFavorite(settings.favorites, item);
      const itemRow = document.createElement('div');
      itemRow.className = 'watch-item' + (active ? ' active' : '');
      itemRow.setAttribute('role','listitem');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'watch-item-open';
      button.setAttribute('aria-current', active ? 'true' : 'false');
      button.setAttribute('aria-label', 'Open ' + symbolLabel(item.symbol) + ' on ' + MARKET_NAMES[item.market]);
      const text = document.createElement('span');
      text.className = 'watch-main';
      const name = document.createElement('span');
      name.className = 'watch-symbol';
      name.textContent = symbolLabel(item.symbol);
      const venue = document.createElement('span');
      venue.className = 'watch-venue';
      venue.textContent = MARKET_NAMES[item.market];
      text.append(name, venue);
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'watch-star';
      star.textContent = pinned ? '★' : '☆';
      star.setAttribute('aria-label', (pinned ? 'Remove ' : 'Pin ') + symbolLabel(item.symbol));
      star.setAttribute('aria-pressed', String(pinned));
      star.addEventListener('click', () => favoriteAction(item));
      button.append(text);
      button.addEventListener('click', () => changeMarket(item));
      itemRow.append(button, star);
      fragment.append(itemRow);
    }
    holder.append(fragment);
    const activeStar = isFavorite(settings.favorites, currentMarket());
    const starButton = el('star-current');
    starButton.textContent = activeStar ? '★' : '☆';
    starButton.setAttribute('aria-pressed', String(activeStar));
    starButton.setAttribute('aria-label', activeStar ?
      'Remove current market from favorites' : 'Add current market to favorites');
    el('watchlist-add').textContent = activeStar ? '★ Saved to favorites' : '+ Save current market';
    el('watchlist-starred').classList.toggle('active', favoritesTab === 'starred');
    el('watchlist-explore').classList.toggle('active', favoritesTab === 'explore');
    el('watchlist-starred').setAttribute('aria-pressed', String(favoritesTab === 'starred'));
    el('watchlist-explore').setAttribute('aria-pressed', String(favoritesTab === 'explore'));
  }

  function refresh() {
    renderWatchlist();
    el('theme-select').value = settings.theme;
  }

  function updateLayout() {
    const compact = window.matchMedia('(max-width:1110px)').matches;
    workspace.classList.toggle('watchlist-collapsed', !settings.watchlistVisible);
    workspace.classList.toggle('watchlist-drawer', compact && settings.watchlistVisible);
    workspace.classList.toggle('depth-collapsed', !settings.depthVisible);
    for (const [id, value] of [
      ['watchlist-toggle', settings.watchlistVisible],
      ['depth-toggle', settings.depthVisible]
    ]) {
      const button = el(id);
      button.classList.toggle('active', value);
      button.setAttribute('aria-pressed', String(value));
    }
    persist();
    requestAnimationFrame(() => chart.resize());
  }

  function toggleWatchlist() {
    settings.watchlistVisible = !settings.watchlistVisible;
    updateLayout();
  }

  function toggleDepth() {
    settings.depthVisible = !settings.depthVisible;
    updateLayout();
  }

  function saveChartImage() {
    const canvas = chart.canvas;
    if (!canvas?.toBlob) return toast('Chart image export is unavailable');
    const market = settings.market + '-' + settings.symbol + '-' + settings.interval;
    canvas.toBlob((blob) => {
      if (!blob) return toast('Could not render PNG');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bitcornwisdom-' + market + '.png';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Chart PNG exported');
    }, 'image/png');
  }

  const actions = [
    { id: 'favorite', title: 'Star current market', detail: 'Save or remove pair from favorites', keywords: 'pin bookmark', run: () => favoriteAction() },
    { id: 'export', title: 'Export chart as PNG', detail: 'Save the currently visible Canvas chart', keywords: 'image screenshot download', run: saveChartImage },
    { id: 'reset', title: 'Reset chart view', detail: 'Return to latest candles', keywords: 'home scroll', run: () => chart.resetView() },
    { id: 'layout-single', title: 'One chart layout', detail: 'Focus on one market', keywords: 'grid layout single', run: () => onSetLayout(1) },
    { id: 'layout-two', title: 'Two chart layout', detail: 'Split market desk', keywords: 'grid layout split', run: () => onSetLayout(2) },
    { id: 'layout-four', title: 'Four chart layout', detail: 'Four live market panels', keywords: 'grid layout quad', run: () => onSetLayout(4) },
    { id: 'link-time', title: 'Toggle linked time navigation', detail: 'Sync pan and zoom across visible charts', keywords: 'grid synchronized scroll', run: onToggleTimeLink },
    { id: 'link-cursor', title: 'Toggle shared crosshair', detail: 'Align the time cursor across visible charts', keywords: 'grid synchronized cursor', run: onToggleCursorLink },
    { id: 'select', title: 'Select drawing', detail: 'Click an annotation to edit its anchors', keywords: 'drawing edit move', run: () => setDrawingTool('select') },
    { id: 'trend', title: 'Draw trend line', detail: 'Two clicks to anchor a line', keywords: 'drawing trend', run: () => setDrawingTool('line') },
    { id: 'horizontal', title: 'Draw horizontal level', detail: 'Single click to place a price level', keywords: 'drawing price hline', run: () => setDrawingTool('horizontal') },
    { id: 'vertical', title: 'Draw vertical marker', detail: 'Single click to mark a time', keywords: 'drawing time vline', run: () => setDrawingTool('vertical') },
    { id: 'fibonacci', title: 'Draw Fibonacci retracement', detail: 'Two clicks; 0/23.6/38.2/50/61.8/78.6/100%', keywords: 'drawing fib retrace', run: () => setDrawingTool('fib') },
    { id: 'delete-selected', title: 'Delete selected drawing', detail: 'Remove the current annotation', keywords: 'drawing remove', run: () => chart.removeSelected() },
    { id: 'clear-drawings', title: 'Clear drawings for this chart', detail: 'Delete the current market/timeframe annotations', keywords: 'drawing erase all', run: () => {
      if (chart.drawings.length && window.confirm('Delete all chart drawings on this market and timeframe?')) chart.clearDrawings();
    } },
    { id: 'watchlist', title: 'Toggle watchlist panel', detail: 'Show or hide the left navigation', keywords: 'sidebar w', run: toggleWatchlist },
    { id: 'orderbook', title: 'Toggle order book panel', detail: 'Show or hide live depth and trades', keywords: 'sidebar b', run: toggleDepth },
    { id: 'ema', title: 'Toggle EMA 20', detail: 'Exponential moving average overlay', keywords: 'indicator', run: () => setIndicator('showEMA') },
    { id: 'sma', title: 'Toggle SMA 50', detail: 'Simple moving average overlay', keywords: 'indicator', run: () => setIndicator('showSMA') },
    { id: 'bb', title: 'Toggle Bollinger Bands', detail: '20 periods · two standard deviations', keywords: 'indicator volatility', run: () => setIndicator('showBB') },
    { id: 'rsi', title: 'Toggle RSI 14', detail: 'Relative strength indicator pane', keywords: 'indicator oscillator', run: () => setIndicator('showRSI') },
    { id: 'scale', title: 'Toggle logarithmic scale', detail: 'Switch linear / log price axis', keywords: 'y axis', run: () => setIndicator('logarithmic') },
    { id: 'demo', title: 'Toggle offline demo', detail: 'Switch between live and labelled synthetic data', keywords: 'sample test', run: () => { settings.demo = !settings.demo; loadMarket(); } }
  ];

  function paletteEntries(query) {
    const markets = [...sanitizeFavorites(settings.favorites), ...MARKET_PRESETS]
      .filter((v, i, all) => all.findIndex((m) => marketKey(m) === marketKey(v)) === i)
      .map((v) => ({
        id: 'market:' + marketKey(v), type: 'market',
        title: symbolLabel(v.symbol), detail: MARKET_NAMES[v.market],
        keywords: marketKey(v), run: () => changeMarket(v)
      }));
    const commands = actions.map((a) => ({ ...a, type: 'action' }));
    const themes = THEME_IDS.map((id) => ({
      id: 'theme:' + id, type: 'theme', title: 'Theme: ' + THEME_NAMES[id],
      detail: 'Change workspace color palette', keywords: id,
      run: () => updateTheme(id)
    }));
    const intervals = ['1m','5m','15m','1h','4h','1d'].map((interval) => ({
      id: 'tf:' + interval, type: 'action', title: 'Timeframe ' + interval,
      detail: 'Switch the chart to ' + interval, keywords: 'time candle',
      run: () => {
        try { validateSelection(settings.market, settings.symbol, interval); }
        catch { return toast('Interval unavailable for this market'); }
        settings.interval = interval;
        loadMarket();
      }
    }));
    let all = [...markets, ...commands, ...themes, ...intervals];
    const compact = query.trim().toUpperCase().replaceAll(' ', '');
    if (/^[A-Z0-9]{4,24}$/.test(compact)) {
      all = [{
        id: 'custom:' + compact, type: 'market',
        title: 'Open ' + symbolLabel(compact),
        detail: 'Current venue · ' + MARKET_NAMES[settings.market],
        keywords: compact,
        run: () => changeMarket({ market: settings.market, symbol: compact })
      }, ...all];
    }
    return searchPalette(all, query, 13);
  }

  function renderPalette() {
    results = paletteEntries(searchField.value);
    selectedIndex = Math.min(selectedIndex, Math.max(results.length - 1, 0));
    resultsNode.replaceChildren();
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = 'No matches. Try a symbol such as BTCUSD or a command such as RSI.';
      resultsNode.append(empty);
    }
    results.forEach((entry, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'palette-result' + (index === selectedIndex ? ' selected' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === selectedIndex));
      const icon = document.createElement('span');
      icon.className = 'palette-result-icon';
      icon.textContent = entry.type === 'market' ? '↗' : entry.type === 'theme' ? '◈' : '⌘';
      const main = document.createElement('span');
      main.className = 'palette-result-main';
      const title = document.createElement('span');
      title.className = 'palette-result-title';
      title.textContent = entry.title;
      const detail = document.createElement('span');
      detail.className = 'palette-result-detail';
      detail.textContent = entry.detail;
      main.append(title,detail);
      const hint = document.createElement('span');
      hint.className = 'palette-result-accelerator';
      hint.textContent = entry.type === 'market' ? 'PAIR' : entry.type === 'theme' ? 'COLOR' : 'ACTION';
      row.append(icon,main,hint);
      row.addEventListener('mouseenter', () => {
        selectedIndex = index;
        for (const item of resultsNode.children) {
          item.classList.toggle('selected', item === row);
          item.setAttribute('aria-selected', String(item === row));
        }
      });
      row.addEventListener('click', () => runEntry(index));
      resultsNode.append(row);
    });
  }

  function runEntry(index) {
    const command = results[index];
    if (!command) return;
    dialog.close();
    searchField.value = '';
    command.run();
  }

  function openPalette(initial = '') {
    if (dialog.open) return;
    searchField.value = initial;
    selectedIndex = 0;
    renderPalette();
    dialog.showModal();
    searchField.focus();
    searchField.select();
  }

  el('command-open').addEventListener('click', () => openPalette());
  el('command-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  searchField.addEventListener('input', () => { selectedIndex = 0; renderPalette(); });
  searchField.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) +
        results.length) % Math.max(1, results.length);
      renderPalette();
      resultsNode.children[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runEntry(selectedIndex);
    }
  });

  el('theme-select').addEventListener('change', (event) => updateTheme(event.target.value));
  el('star-current').addEventListener('click', () => favoriteAction());
  el('watchlist-add').addEventListener('click', () => {
    if (!isFavorite(settings.favorites, currentMarket())) favoriteAction();
    else toast('Already on your watchlist');
  });
  el('watchlist-filter').addEventListener('input', renderWatchlist);
  el('watchlist-starred').addEventListener('click', () => { favoritesTab = 'starred'; renderWatchlist(); });
  el('watchlist-explore').addEventListener('click', () => { favoritesTab = 'explore'; renderWatchlist(); });
  el('watchlist-toggle').addEventListener('click', toggleWatchlist);
  el('depth-toggle').addEventListener('click', toggleDepth);
  el('export-chart').addEventListener('click', saveChartImage);
  window.addEventListener('resize', () => {
    // The same preference drives desktop collapse and mobile drawer state.
    updateLayout();
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (!dialog.open) openPalette();
      return;
    }
    if (dialog.open || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '/') { event.preventDefault(); openPalette(); }
    else if (event.key.toLowerCase() === 'w') toggleWatchlist();
    else if (event.key.toLowerCase() === 'b') toggleDepth();
    else if (event.key.toLowerCase() === 'd') setDrawingTool('select');
    else if (event.key.toLowerCase() === 'l') setDrawingTool('line');
    else if (event.key.toLowerCase() === 'h') setDrawingTool('horizontal');
    else if (event.key.toLowerCase() === 'v') setDrawingTool('vertical');
    else if (event.key.toLowerCase() === 'f') setDrawingTool('fib');
    else if (event.key === '?') { event.preventDefault(); openPalette('toggle'); }
  });

  // Always use validated stored settings, including files edited by external scripts.
  settings.theme = normalTheme(settings.theme);
  settings.favorites = sanitizeFavorites(settings.favorites);
  settings.watchlistVisible = Boolean(settings.watchlistVisible);
  settings.depthVisible = Boolean(settings.depthVisible);
  root.dataset.theme = settings.theme;
  chart.setOptions({ theme: settings.theme });
  el('theme-select').value = settings.theme;
  updateLayout();
  renderWatchlist();

  return {
    refresh,
    setQuote(price) {
      const node = document.querySelector('.watch-item.active .watch-venue');
      if (node && Number.isFinite(price)) {
        node.textContent = MARKET_NAMES[settings.market] + ' · ' +
          price.toLocaleString('en-US', { maximumFractionDigits: 2 });
      }
    },
    toast,
    openPalette,
    saveChartImage
  };
}
