import { mountBitcornChart } from './embed-sdk.js';

const demo = new URLSearchParams(location.search).get('demo') === '1';
let isDemo = demo;
let theme = 'noir';
const left = mountBitcornChart('#lab-a', {
  instrument: 'BTC-USD-SPOT', interval: '1m', preferred: 'kraken',
  demo, height: '420px', title: 'BTC/USD live embedded chart'
});
const right = mountBitcornChart('#lab-b', {
  instrument: 'ETH-USD-SPOT', interval: '1m', preferred: 'coinbase',
  demo, height: '420px', title: 'ETH/USD live embedded chart'
});
window.bitcornDemo = { left, right };
const byId = id => document.getElementById(id);
function sourceStatus(widget, label) {
  widget.on('source', ({ source, reason }) => {
    byId(label).textContent = source ?
      source.venue.toUpperCase() + ' · ' + reason : 'No available venue';
  });
  widget.on('status', ({ state, source }) => {
    if (source) byId(label).textContent = source.venue.toUpperCase() + ' · ' + state;
    else byId(label).textContent = state.toUpperCase();
  });
  widget.on('error', ({ message }) => {
    byId('lab-status').textContent = 'Feed notice: ' + message;
  });
}
sourceStatus(left, 'lab-a-source');
sourceStatus(right, 'lab-b-source');
Promise.all([left.ready, right.ready]).then(() => {
  byId('lab-status').textContent = isDemo ?
    '2 EMBEDS READY · SYNTHETIC DEMO' : '2 EMBEDS READY · LIVE PUBLIC SOURCES';
}).catch(error => {
  byId('lab-status').textContent = 'Embed error: ' + error.message;
});
byId('lab-switch').addEventListener('click', () => left.setMarket('ETH-USD-SPOT', '1m'));
byId('lab-timeframe').addEventListener('click', () => {
  left.setSelection({ interval: '5m' });
  right.setSelection({ interval: '5m' });
});
byId('lab-theme').addEventListener('click', () => {
  theme = theme === 'noir' ? 'verdigris' : 'noir';
  left.setTheme(theme);
  right.setTheme(theme);
});
byId('lab-live').addEventListener('click', () => {
  isDemo = !isDemo;
  left.setSelection({ demo: isDemo });
  right.setSelection({ demo: isDemo });
  byId('lab-status').textContent = isDemo ? 'SWITCHING TO DEMO' : 'CONNECTING TO PUBLIC FEEDS';
});
window.addEventListener('pagehide', () => {
  left.destroy();
  right.destroy();
});
