# nostr-order-listener

Lightweight Nostr relay listener that forwards NIP-15/NIP-99 marketplace orders to WooCommerce stores.

## Quick Start

### Docker (Recommended)

```bash
docker run -d \
  --name nostr-listener \
  -p 3847:3847 \
  -e ADMIN_TOKEN=$(openssl rand -hex 32) \
  -e RELAYS="wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band" \
  ghcr.io/renandkiwi/nostr-order-listener:latest
```

### Node.js

```bash
git clone https://github.com/RenAndKiwi/nostr-order-listener.git
cd nostr-order-listener
npm install && npm run build
cp .env.example .env  # Edit with your settings
npm start
```

Then register your merchant:
```bash
curl -X POST http://localhost:3847/api/merchants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "pubkey": "your-merchant-npub-or-hex",
    "webhookUrl": "https://yourstore.com/wp-json/woo-nostr-market/v1/order-webhook",
    "webhookSecret": "your-webhook-secret-min-16-chars"
  }'
```

---

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

## What It Does

1. Connects to Nostr relays via WebSocket
2. Subscribes to `kind:4` DMs addressed to registered merchant pubkeys
3. Forwards encrypted events to merchant WordPress webhooks
4. WordPress decrypts, creates order, sends Lightning invoice back to customer

## What It Doesn't Do

- ❌ Store or see private keys (nsec)
- ❌ Decrypt order contents
- ❌ Handle payments or invoices
- ❌ Log sensitive data

## Features

- **Multi-merchant support** — One instance serves multiple WooCommerce stores
- **Zero key custody** — Merchants keep their private keys in WordPress
- **No payment handling** — Each merchant uses their own BTCPay Server
- **Minimal logging** — Only logs event IDs and delivery status, never content
- **Relay redundancy** — Subscribes to multiple relays for reliability
- **Webhook retry** — Retries failed deliveries with exponential backoff

---

## Configuration

### Environment Variables

```bash
# .env
PORT=3847
HOST=0.0.0.0
LOG_LEVEL=info

# Nostr Relays (comma-separated)
RELAYS=wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band

# Admin API authentication (generate with: openssl rand -hex 32)
ADMIN_TOKEN=your-secure-token-here

# Optional: Path to merchants config file
MERCHANTS_FILE=./merchants.json
```

### Registering Merchants

#### Via API

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
      "pubkey": "abc123def456...",
      "webhookUrl": "https://store1.com/wp-json/woo-nostr-market/v1/order-webhook",
      "webhookSecret": "secret1-min-16-chars",
      "enabled": true
    }
  ]
}
```

---

## Deployment

### Docker Compose

```yaml
version: '3.8'
services:
  nostr-listener:
    image: ghcr.io/renandkiwi/nostr-order-listener:latest
    restart: unless-stopped
    ports:
      - "3847:3847"
    environment:
      - ADMIN_TOKEN=${ADMIN_TOKEN}
      - RELAYS=wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band
    volumes:
      - ./merchants.json:/app/merchants.json
```

### Systemd

```ini
# /etc/systemd/system/nostr-listener.service
[Unit]
Description=Nostr Order Listener
After=network.target

[Service]
Type=simple
User=nostr
WorkingDirectory=/opt/nostr-order-listener
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### With nginx (SSL)

```nginx
server {
    listen 443 ssl http2;
    server_name listener.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/listener.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/listener.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3847;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Health check |
| `/api/stats` | GET | No | Service statistics |
| `/api/merchants` | GET | No | List merchants (pubkeys only) |
| `/api/merchants` | POST | Yes | Register merchant |
| `/api/merchants/:pubkey` | DELETE | Yes | Remove merchant |

### Example: Check Stats

```bash
curl http://localhost:3847/api/stats
```

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

---

## Security Model

### What the listener knows:
- Merchant public keys (not private keys)
- Webhook URLs
- Event IDs that were forwarded
- Delivery success/failure status

### What the listener NEVER sees:
- Decrypted order contents
- Customer addresses or contact info
- Payment details or invoices
- Private keys (nsec)

### Webhook Signature Verification

Every webhook includes an HMAC signature:
```
X-Webhook-Signature: sha256=<hmac of body using merchant's webhookSecret>
```

WordPress verifies this before processing.

---

## WordPress Plugin Setup

In your WordPress admin (WooCommerce → Nostr Market):

1. Configure your Nostr keys
2. Go to "Order Receiving" section
3. Copy your webhook URL
4. Generate a webhook secret
5. Register with the listener using the API

See [woo-nostr-market documentation](https://github.com/RenAndKiwi/sovereign-marketplace/tree/main/wordpress-plugin/woo-nostr-market) for full setup.

---

## Troubleshooting

### Orders not arriving

1. Check listener logs for connection status
2. Verify merchant is registered: `GET /api/merchants`
3. Check relay connections: `GET /api/stats`
4. Test webhook endpoint:
   ```bash
   curl -X POST https://yourstore.com/wp-json/woo-nostr-market/v1/webhook-test
   ```

### Relay disconnections

The listener auto-reconnects with exponential backoff. Check `/api/stats` for connection status.

### Webhook failures

Check your WordPress error logs. Common issues:
- Webhook secret mismatch
- SSL certificate problems
- WordPress REST API disabled

---

## Development

```bash
npm run dev      # Watch mode
npm run build    # Compile TypeScript
npm run lint     # Lint code
npm test         # Run tests
```

---

## License

MIT

## Links

- [woo-nostr-market WordPress plugin](https://github.com/RenAndKiwi/sovereign-marketplace/tree/main/wordpress-plugin/woo-nostr-market)
- [NIP-15 Specification](https://github.com/nostr-protocol/nips/blob/master/15.md)
- [NIP-99 Specification](https://github.com/nostr-protocol/nips/blob/master/99.md)
- [NIP-04 Specification](https://github.com/nostr-protocol/nips/blob/master/04.md)
