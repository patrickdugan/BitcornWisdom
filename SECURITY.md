# Security policy

BitcornWisdom is read-only market visualization software. It uses public exchange endpoints and stores chart preferences and sampled liquidity locally. It does not request exchange credentials, place orders, or connect wallets.

For vulnerabilities involving data exposure or script execution, please use a private GitHub security advisory where available. Include a small reproduction, affected versions/browsers and the impact, without sharing real credentials.

The local Node server restricts frontend asset paths and sets Content Security Policy headers. Public static hosts should apply suitable HTTPS and security headers.

Market-data access and integrity guarantees vary by exchange. A geo-blocked response or a transient network error does not by itself establish an application vulnerability. Synthetic demo market data is explicitly labelled.
