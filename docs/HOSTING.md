# Hosting BitcornWisdom

The application consists of static browser assets, with direct public REST/WebSocket exchange feeds and no build step. Node is used only for its small local static server.

## Local development

    npm start

Open http://127.0.0.1:5173/ for live feeds. Add ?demo=1 to use the deterministic offline market.

Bind a different interface or port as needed:

    HOST=127.0.0.1 PORT=5188 npm start

Use trusted interfaces or a correctly configured HTTPS reverse proxy when exposing the local server.

## Public HTTPS live preview on GitHub Pages

The repository includes [the publishing workflow](../.github/workflows/pages.yml).
On every relevant push to `main` and on manual dispatch it stages only:
`index.html`, `grid.html`, `embed.html`, `embed-lab.html`, their stylesheets, favicon, and `src/*.js`.
The workflow uses `actions/upload-pages-artifact` and `actions/deploy-pages`
to publish HTTPS static assets. The local Node server is not deployed.

**One-time GitHub setting:** In **Settings → Pages → Build and deployment → Source**,
choose **GitHub Actions**. This is required if Pages has not already been
activated on the repository. Re-run **Actions → Public live preview → Run workflow**
on `main` once the source is selected.

When deployment succeeds, the expected endpoints are:

- Classic desk, live Kraken 1m: `https://patrickdugan.github.io/BitcornWisdom/index.html?market=kraken&symbol=BTCUSD&interval=1m&demo=0`
- Multi-chart workstation: `https://patrickdugan.github.io/BitcornWisdom/grid.html?mode=4&demo=0`
- Embedded chart: `https://patrickdugan.github.io/BitcornWisdom/embed.html?instrument=BTC-USD-SPOT&interval=1m`
- Embed SDK lab: `https://patrickdugan.github.io/BitcornWisdom/embed-lab.html?demo=1`
- Offline fallback: `https://patrickdugan.github.io/BitcornWisdom/index.html?demo=1`

GitHub Pages publishes static files and has **no exchange proxy or backend
runtime**. The visitor's browser directly opens public WebSockets and REST
requests to Kraken, Coinbase or Binance, so exchange availability and
geographical restrictions are visitor-specific. The real feed shows `LIVE`,
real price data, a current trade tape, and synchronized book depth.
The offline demo is clearly marked as synthetic.

The deployment workflow tests public HTML and module URLs, then runs an
advisory Chrome exchange probe against the deployed origin. Inspect its
`public-live-preview-evidence` Actions artifact for JSON probe results and
screenshots. If a venue is blocked by region or network, another supported
public venue can be selected from the classic desk. Browser settings and
replay data remain local to each site's origin.

The repository's GitHub Actions token cannot create or enable the GitHub
Pages site by itself; this one-time source setting belongs to a repository
administrator. No exchange credentials or API keys are required.

## Other static hosts

The application has no build dependencies. Other HTTPS hosts such as Vercel,
Cloudflare Pages and Netlify can serve exactly the same public asset set.
Root-relative references are avoided, making the site compatible with
subdirectory mounts and CDN prefixes.

## Network and privacy

Browsers request public market data directly from Binance, Kraken and Coinbase, subject to each venue's CORS, region and rate restrictions. Keep public deployments on HTTPS.

IndexedDB liquidity archives, favorites and chart settings are local to the origin and browser. A localhost deployment and a publicly hosted deployment have different storage. There is no hosted account service, telemetry dependency or secret key requirement.

PNG chart export happens locally in the browser. No screenshot data is uploaded.

## Release checks

Run npm run check, npm run smoke and npm run smoke:archive. Review the resulting Chrome screenshot artifact and check desktop/mobile breakpoints. Live probes are optional diagnostics.

## Embedding other websites and application dashboards

The independently styled `embed.html` is framed intentionally; the full
trading desk keeps its anti-framing CSP. The embed uses its own origin, makes
read-only public data requests, and authenticates its parent messages
by the iframe identity and exact parent origin. Other pages retain
their strict source allowlists. Static publishing hosts may need CSP and
`frame-ancestors` headers configured appropriately for iframe consumers.
See [the Embed SDK specification](EMBED.md).
