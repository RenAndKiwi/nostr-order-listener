# nostr-order-listener

Nostr relay listener that bridges NIP-15 marketplace orders to WooCommerce stores, with built-in product publishing to the Shopstr marketplace.

## Features

- **Order Listening** — Subscribes to Nostr relays for kind:4 DMs addressed to registered merchant pubkeys, forwards orders to WooCommerce via webhooks or creates BTCPay invoices directly
- **Product Publishing** — Fetches products from WooCommerce REST API and publishes them as kind:30402 (NIP-15) product listing events to Nostr relays, compatible with [Shopstr](https://shopstr.market)
- **Multi-merchant support** — One instance serves multiple WooCommerce stores
- **BTCPay integration** — Create invoices directly via BTCPay Server API
- **Relay redundancy** — Subscribes to multiple relays with auto-reconnect
- **Webhook retry** — Retries failed deliveries with exponential backoff

## Architecture

```
┌──────────────┐      ┌──────────────────────┐      ┌──────────────────┐
│ WooCommerce  │◀────▶│  nostr-order-listener │◀────▶│  Nostr Relays    │
│ (products +  │      │                      │      │                  │
│  orders)     │      │  • publishes products │      │  kind:30402      │
│              │      │  • listens for orders │      │  (listings)      │
│ BTCPay Server│◀─────│  • creates invoices   │      │  kind:4 (orders) │
└──────────────┘      └──────────────────────┘      └──────────────────┘
                                                           ▲
                                                           │
                                                    ┌──────┴───────┐
                                                    │   Shopstr    │
                                                    │  Marketplace │
                                                    └──────────────┘
```

## Quick Start

### Docker Compose (Recommended)

```yaml
services:
  nostr-listener:
    build: .
    container_name: nostr-order-listener
    restart: unless-stopped
    ports:
      - "127.0.0.1:3847:3847"
    dns:
      - 8.8.8.8
      - 1.1.1.1
    environment:
      - PORT=3847
      - HOST=0.0.0.0
      - LOG_LEVEL=info
      - RELAYS=wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band
      - ADMIN_TOKEN=your-secure-token-here
      # Product publishing (optional)
      - NOSTR_PRIVATE_KEY=your-64-char-hex-private-key
      - NOSTR_PUBKEY=your-64-char-hex-public-key
      - WC_URL=https://your-woocommerce-store.com
      - WC_CONSUMER_KEY=ck_your_key
      - WC_CONSUMER_SECRET=cs_your_secret
      - LISTING_CURRENCY=USD
      - LISTING_LOCATION=Worldwide
      - LISTING_SHIPPING=Domestic,International
    volumes:
      - ./merchants.json:/app/merchants.json
```

```bash
docker compose up -d
```

### Node.js

```bash
git clone https://github.com/RenAndKiwi/nostr-order-listener.git
cd nostr-order-listener
npm install && npm run build
cp .env.example .env  # Edit with your settings
npm start
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3847` | API server port |
| `HOST` | No | `0.0.0.0` | API server host |
| `LOG_LEVEL` | No | `info` | Log level (debug, info, warn, error) |
| `RELAYS` | No | `wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band` | Comma-separated relay URLs |
| `ADMIN_TOKEN` | Yes | — | Bearer token for admin API endpoints |
| `MERCHANTS_FILE` | No | `./merchants.json` | Path to merchants config |
| `NOSTR_PRIVATE_KEY` | For publishing | — | 64-char hex private key (not nsec) |
| `NOSTR_PUBKEY` | For publishing | — | 64-char hex public key |
| `WC_URL` | For publishing | — | WooCommerce store URL (must match WordPress `siteurl`) |
| `WC_CONSUMER_KEY` | For publishing | — | WooCommerce REST API consumer key |
| `WC_CONSUMER_SECRET` | For publishing | — | WooCommerce REST API consumer secret |
| `LISTING_CURRENCY` | No | `USD` | Currency code for product listings |
| `LISTING_LOCATION` | No | `Worldwide` | Location tag for product listings |
| `LISTING_SHIPPING` | No | `Domestic,International` | Comma-separated shipping methods |

### Important Notes

- **`NOSTR_PRIVATE_KEY`** must be in hex format (64 characters). If you have an nsec, convert it first:
  ```bash
  node -e "const {nip19} = require('nostr-tools'); console.log(Buffer.from(nip19.decode('nsec1...').data).toString('hex'))"
  ```
- **`WC_URL`** must match your WordPress `siteurl` option exactly (e.g. `https://shop.example.com`), not the server IP. WooCommerce rejects API requests that don't match.
- **WooCommerce API keys** need **Read/Write** permissions and must be created by an Administrator user.
- **`NOSTR_PRIVATE_KEY`** is also required for **receiving orders** — incoming kind:4 DMs are NIP-04 encrypted and must be decrypted before parsing.
- **`merchants.json`** must be mounted **without** `:ro` (read-only) so merchant registrations persist across container rebuilds.
- When running Docker with systemd-resolved (Ubuntu), add `dns: [8.8.8.8, 1.1.1.1]` to your compose file to avoid DNS resolution failures inside the container.

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Health check |
| `/api/stats` | GET | No | Service statistics |
| `/api/merchants` | GET | No | List merchants (pubkeys only) |
| `/api/merchants` | POST | Bearer | Register merchant |
| `/api/merchants/:pubkey` | DELETE | Bearer | Remove merchant |
| `/api/publish` | POST | Bearer | Publish WooCommerce products to Nostr/Shopstr |
| `/api/unpublish` | POST | Bearer | Remove product listings from Nostr/Shopstr |

### Publish Products

```bash
curl -X POST http://localhost:3847/api/publish \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

Response:
```json
{
  "published": 16,
  "failed": 0,
  "total": 16,
  "relays": ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"]
}
```

### Register Merchant (Order Listening)

```bash
curl -X POST http://localhost:3847/api/merchants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "pubkey": "npub1...",
    "webhookUrl": "https://yourstore.com/wp-json/woo-nostr-market/v1/order-webhook",
    "webhookSecret": "your-webhook-secret-min-16-chars"
  }'
```

Or with BTCPay direct integration:
```bash
curl -X POST http://localhost:3847/api/merchants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "pubkey": "npub1...",
    "btcpay": {
      "url": "https://your-btcpay.com",
      "storeId": "your-store-id",
      "apiKey": "your-api-key"
    }
  }'
```

---

## Relay Alignment

For Shopstr integration to work, the relays used by this listener **must match** the relays configured in your BTCPay Nostr plugin. Both product listings (kind:30402) and order DMs (kind:4) need to be on the same relays.

Default relays: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`

---

## Security

- The listener never stores or sees private keys (nsec)
- Order contents are forwarded as encrypted kind:4 events — decryption happens in WordPress
- Webhook deliveries are HMAC-signed (`X-Webhook-Signature: sha256=...`)
- The `NOSTR_PRIVATE_KEY` for publishing is only used to sign product listing events
- Admin endpoints require Bearer token authentication

---

## Development

```bash
npm run dev      # Watch mode with tsx
npm run build    # Compile TypeScript
npm run lint     # Lint code
npm test         # Run tests
```

## License

MIT

## Links

- [Shopstr Marketplace](https://shopstr.market)
- [nostr-order-bridge](https://github.com/RenAndKiwi/nostr-order-bridge) — Merchant onboarding/registration companion
- [NIP-15 Specification](https://github.com/nostr-protocol/nips/blob/master/15.md)
