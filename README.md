# nostr-order-listener

Lightweight Nostr relay listener that forwards NIP-15 marketplace orders to WooCommerce stores.

## Overview

This service bridges Nostr relays and WordPress/WooCommerce stores running the [woo-nostr-market](https://github.com/RenAndKiwi/sovereign-marketplace/tree/main/wordpress-plugin/woo-nostr-market) plugin.

**Key principle:** The listener **never sees decrypted orders** and **never handles payments**. It forwards encrypted Nostr events to your WordPress, which decrypts and processes them using your keys.

```
┌──────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Nostr Relays    │────▶│  nostr-order-listener│────▶│  Your WordPress  │
│  (kind:4 DMs)    │     │  (forwards events)   │     │  (decrypts,      │
└──────────────────┘     └─────────────────────┘     │   creates order) │
                                                      │  + BTCPay Server │
                                                      └──────────────────┘
```

## Features

- **Multi-merchant support** — One instance serves multiple WooCommerce stores
- **Zero key custody** — Merchants keep their private keys in WordPress
- **No payment handling** — Each merchant uses their own BTCPay Server
- **Minimal logging** — Only logs event IDs and delivery status, never content
- **Relay redundancy** — Subscribes to multiple relays for reliability
- **Webhook retry** — Retries failed deliveries with exponential backoff

## Requirements

- Node.js 20+
- A VPS or server with persistent uptime
- WooCommerce stores with woo-nostr-market plugin installed

## Installation

```bash
git clone https://github.com/RenAndKiwi/nostr-order-listener.git
cd nostr-order-listener
npm install
cp .env.example .env
```

## Configuration

### Environment Variables

```bash
# .env
PORT=3847
LOG_LEVEL=info

# Default relays (comma-separated)
RELAYS=wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band

# Webhook secret for verifying requests from merchants
WEBHOOK_SECRET=your-random-secret-here
```

### Registering Merchants

Merchants register via the REST API or config file:

#### Via API (recommended)

```bash
curl -X POST http://localhost:3847/api/merchants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "pubkey": "npub1abc...",
    "webhookUrl": "https://yourstore.com/wp-json/woo-nostr-market/v1/order-webhook",
    "webhookSecret": "merchant-specific-secret"
  }'
```

#### Via Config File

```json
// merchants.json
{
  "merchants": [
    {
      "pubkey": "abc123...",
      "webhookUrl": "https://store1.com/wp-json/woo-nostr-market/v1/order-webhook",
      "webhookSecret": "secret1",
      "enabled": true
    },
    {
      "pubkey": "def456...",
      "webhookUrl": "https://store2.com/wp-json/woo-nostr-market/v1/order-webhook", 
      "webhookSecret": "secret2",
      "enabled": true
    }
  ]
}
```

## Running

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start

# Or with PM2
pm2 start dist/index.js --name nostr-order-listener
```

### Docker

```bash
docker build -t nostr-order-listener .
docker run -d \
  -p 3847:3847 \
  -v $(pwd)/merchants.json:/app/merchants.json \
  -e RELAYS="wss://relay.damus.io,wss://nos.lol" \
  nostr-order-listener
```

## How It Works

### 1. Subscription

On startup, the listener:
1. Loads registered merchant pubkeys
2. Connects to configured relays via WebSocket
3. Subscribes to `kind:4` events where `#p` matches any merchant pubkey

```javascript
// Subscription filter
{
  "kinds": [4],
  "#p": ["pubkey1", "pubkey2", "pubkey3"]
}
```

### 2. Event Reception

When a kind:4 event arrives:
1. Check if `#p` tag matches a registered merchant
2. If yes, forward the **entire encrypted event** to merchant's webhook
3. Log delivery status (event ID only, never content)

### 3. Webhook Delivery

The listener POSTs to the merchant's WordPress:

```json
POST /wp-json/woo-nostr-market/v1/order-webhook
Content-Type: application/json
X-Webhook-Signature: sha256=...

{
  "event": {
    "id": "abc123...",
    "pubkey": "customer_pubkey...",
    "created_at": 1706000000,
    "kind": 4,
    "tags": [["p", "merchant_pubkey"]],
    "content": "encrypted_content_here...",
    "sig": "signature..."
  },
  "relay": "wss://relay.damus.io",
  "receivedAt": 1706000001
}
```

### 4. WordPress Processing

The woo-nostr-market plugin:
1. Verifies webhook signature
2. Decrypts content using merchant's nsec (NIP-04)
3. Parses order JSON
4. Creates WooCommerce order
5. Generates BTCPay invoice
6. Sends payment request back via Nostr DM

## API Endpoints

### `GET /health`

Health check endpoint.

### `GET /api/stats`

```json
{
  "uptime": 86400,
  "merchants": 5,
  "eventsReceived": 1234,
  "eventsForwarded": 1200,
  "eventsFailed": 34,
  "relayConnections": {
    "wss://relay.damus.io": "connected",
    "wss://nos.lol": "connected"
  }
}
```

### `POST /api/merchants`

Register a new merchant. Requires admin authorization.

### `DELETE /api/merchants/:pubkey`

Remove a merchant registration.

### `GET /api/merchants`

List registered merchants (pubkeys only, no secrets).

## Security

### What the listener knows:
- Merchant public keys (not private keys)
- Webhook URLs
- Event IDs that were forwarded
- Delivery success/failure status

### What the listener NEVER sees:
- Decrypted order contents
- Customer addresses or contact info
- Payment details or invoices
- Private keys

### Webhook Signature Verification

Every webhook request includes an HMAC signature:

```
X-Webhook-Signature: sha256=<hmac of request body using merchant's webhookSecret>
```

WordPress verifies this before processing.

## Logging

By default, logging is minimal:

```
INFO: Connected to wss://relay.damus.io
INFO: Subscribed to 5 merchant pubkeys
INFO: Event abc123 forwarded to store1.com (200 OK)
WARN: Event def456 delivery failed to store2.com (retry 1/3)
```

Content is **never logged**. Set `LOG_LEVEL=debug` only for development.

## WordPress Plugin Setup

In your WordPress admin (WooCommerce → Nostr Market):

1. **Generate or import your Nostr keys** (as usual)
2. **Enable webhook receiving:**
   - Go to "Order Receiving" tab
   - Copy your webhook URL: `https://yourstore.com/wp-json/woo-nostr-market/v1/order-webhook`
   - Generate a webhook secret
3. **Register with the listener:**
   - Provide your pubkey and webhook URL to the listener admin
   - Or self-host your own listener

## Self-Hosting vs Shared

### Self-Host (Recommended for privacy)

Run your own listener on your VPS. You control everything.

```bash
# Your VPS
git clone ... && npm install && npm start
```

Only register your own merchant pubkey.

### Shared Instance

For convenience, multiple merchants can share one listener instance. The listener operator:
- Sees which pubkeys are registered
- Sees event IDs passing through
- Does NOT see order contents (encrypted)
- Does NOT handle payments

## Troubleshooting

### Orders not arriving

1. Check listener logs: `pm2 logs nostr-order-listener`
2. Verify merchant is registered: `GET /api/merchants`
3. Check relay connections: `GET /api/stats`
4. Test webhook endpoint manually:
   ```bash
   curl -X POST https://yourstore.com/wp-json/woo-nostr-market/v1/order-webhook \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```

### Webhook signature failures

1. Ensure `webhookSecret` matches in listener and WordPress
2. Check for proxy/CDN modifying request body

### Relay disconnections

The listener auto-reconnects with exponential backoff. Check `GET /api/stats` for connection status.

## Development

```bash
# Run tests
npm test

# Lint
npm run lint

# Build
npm run build
```

## License

MIT

## Related

- [woo-nostr-market](https://github.com/RenAndKiwi/sovereign-marketplace/tree/main/wordpress-plugin/woo-nostr-market) — WordPress plugin
- [NIP-15 Specification](https://github.com/nostr-protocol/nips/blob/master/15.md) — Nostr Marketplace
- [NIP-04 Specification](https://github.com/nostr-protocol/nips/blob/master/04.md) — Encrypted Direct Messages
