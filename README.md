# VC

Video calls, without the fluff. A minimal, high-quality video calling app built on WebRTC with Cloudflare's real-time infrastructure.

## Architecture

```
app/                  SvelteKit frontend (Vercel)
room-server/          Cloudflare Worker + Durable Object (signaling)
```

The frontend handles the UI, media capture, and WebRTC peer connections. The room server manages per-room presence, chat, and signaling over WebSockets using a Cloudflare Durable Object per room. Media flows through Cloudflare Calls (SFU), not peer-to-peer.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Svelte 5, SvelteKit 2, TypeScript |
| Styling | Tailwind CSS 4 |
| Media relay | Cloudflare Calls (SFU) |
| Signaling | Cloudflare Workers + Durable Objects (WebSockets) |
| TURN | Cloudflare TURN (optional, for firewall traversal) |
| App hosting | Vercel |

## Features

- **Video/audio calls** with automatic active speaker detection
- **Simulcast** — 3 encoding layers adapt to each participant's bandwidth
- **Screen sharing** with tab audio capture
- **Chat** with real-time delivery and unread indicators
- **Adaptive bitrate** — automatically reduces quality on poor connections
- **ICE auto-reconnect** — recovers from network blips without manual intervention
- **Opus DTX** — saves bandwidth when not speaking
- **Hot-plug device detection** — plug in a headset mid-call, it appears immediately
- **Smart device defaults** — remembers your preferred mic/camera/speaker across sessions
- **Mobile-first responsive design** — works on phones, tablets, and desktop
- **Pre-join screen** — preview camera, configure devices, see who's already in the call
- **Invite link** — one-click copy, auto-generated room names

## Getting Started

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account with [Calls](https://developers.cloudflare.com/calls/) enabled

### 1. Clone and install

```bash
cd app && npm install
cd ../room-server && npm install
```

### 2. Configure environment

Create `app/.env`:

```
CF_CALLS_APP_ID=your_app_id
CF_CALLS_APP_SECRET=your_app_secret
```

Get these from the [Cloudflare Dashboard](https://dash.cloudflare.com/) under Calls.

Optional — for TURN (improves connectivity behind firewalls):

```
CF_TURN_KEY_ID=your_turn_key_id
CF_TURN_KEY_SECRET=your_turn_key_secret
```

### 3. Run locally

In two terminals:

```bash
# Terminal 1 — room server
cd room-server
npm run dev
```

```bash
# Terminal 2 — frontend
cd app
npm run dev
```

The app runs at `https://localhost:5173`. The Vite dev server proxies WebSocket connections to the room server on port 8787.

### 4. Open a call

Visit `https://localhost:5173`, click **Start a call**, and share the link. Or go to `https://localhost:5173/new` to auto-generate a room.

## Deploying

### Room server (Cloudflare)

```bash
cd room-server
npx wrangler deploy
```

### Frontend (Vercel)

```bash
cd app
npm run build
```

Deploy via [Vercel CLI](https://vercel.com/docs/cli) or connect the repo to Vercel. Set `CF_CALLS_APP_ID` and `CF_CALLS_APP_SECRET` as environment variables in your Vercel project settings.

Set `VITE_ROOM_SERVER_URL` to your deployed worker URL (e.g. `wss://vc-room-server.your-subdomain.workers.dev`) if not using a proxy, or configure your Vercel project to proxy `/ws-room` to the worker.

## Project Structure

```
app/
├── src/
│   ├── routes/
│   │   ├── +page.svelte              Landing page
│   │   ├── new/+page.ts              Auto-redirect to new room
│   │   ├── [room]/+page.svelte       Pre-join screen
│   │   ├── [room]/call/+page.svelte  In-call UI
│   │   └── api/                      Server routes (session, tracks, TURN)
│   └── lib/
│       ├── components/               VideoTile, ControlBar, ChatPanel
│       ├── stores/                   media.svelte.ts, room.svelte.ts
│       ├── webrtc/session.ts         Cloudflare Calls API client
│       ├── room/                     WebSocket protocol + socket client
│       ├── utils/                    Devices, preferences, room ID generation
│       └── server/env.ts             Server-side config
├── .env
└── svelte.config.js

room-server/
├── src/
│   ├── index.ts                      Worker entry (HTTP → WebSocket upgrade)
│   └── room.ts                       Durable Object (room state, presence, chat)
└── wrangler.toml
```

## Keyboard Shortcuts (in-call)

| Key | Action |
|-----|--------|
| `M` | Toggle mute |
| `V` | Toggle camera |
| `C` | Toggle chat |
| `Esc` | Unpin participant |
