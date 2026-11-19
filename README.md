# Huddle: random video calls

A MERN app with real-time random video calling. Press **Start video call** and you are connected to another person who is online and searching. Video and audio flow peer-to-peer over **WebRTC**; **Socket.IO** handles matching and signaling. Calls cost **credits**, bought with **Razorpay**.

## Features

- Sign up / sign in with **Clerk** (email, Google and more, set in the Clerk dashboard), including password reset and account management
- One button: **Start video call** connects you to a random person who is also searching (video only)
- While waiting you see your own camera and a cancel button. Nothing is charged until you are matched.
- In a call: mute, camera on/off, screen sharing, mute/camera indicators for the other person
- Call history with duration and credits spent
- **Credits & payments** (Razorpay: UPI, cards, netbanking, wallets). Each person in a call pays per minute (2 credits by default). With too few credits the button is disabled and the server refuses the search too. If either person runs out mid-call, the call ends.

## Project layout

```
huddle/
├── client/            React + Vite
│   └── src/
│       ├── context/   Auth, Billing, Socket (presence), Call (matching + WebRTC)
│       ├── components/  Navbar, CallScreen, ...
│       └── pages/     Login, Register, Home, History, Credits
├── server/            Express + Mongoose + Socket.IO
│   └── src/
│       ├── config.js  credit packs and per-minute price
│       ├── models/    User, Call, Payment
│       ├── routes/    auth, calls, ice, payments
│       └── socket.js  presence, matchmaking queue, billing, signaling
├── render.yaml        one-click deploy blueprint
└── package.json       root scripts
```

## Set up login (Clerk)

1. Create a free account at [clerk.com](https://clerk.com) and click **Create application**. Pick the sign-in methods you want (email, Google, ...).
2. Open **API keys** and copy the **Publishable key** (`pk_test_...`) and the **Secret key** (`sk_test_...`).
3. Put them in the two `.env` files:
   - `client/.env`: `VITE_CLERK_PUBLISHABLE_KEY=pk_test_...`
   - `server/.env`: `CLERK_PUBLISHABLE_KEY=pk_test_...` (same value) and `CLERK_SECRET_KEY=sk_test_...`
   
   The secret key belongs on the server only. Never put it in the client folder.
4. Restart both servers after changing `.env` files.

How it works: Clerk provides the `/login` and `/register` pages and manages sessions, passwords and password resets. The client sends Clerk's short-lived session token with every API call and when it connects to Socket.IO; the server checks it with the secret key. The first time someone signs in, the server creates a small record for them that holds their credits and call history. Users and passwords live in Clerk, so manage or delete users in the Clerk dashboard.

Going live: create a production instance in Clerk, add your domain, and use the live keys (`pk_live_...`, `sk_live_...`). Test keys only work for development.

Accounts from the older built-in login are not carried over. For a clean start, drop the `users` collection (or the whole database).

## Run locally

Requirements: Node 20.9+ and MongoDB (local, or a free MongoDB Atlas cluster).

```bash
npm run install:all

cp server/.env.example server/.env   # then edit MONGODB_URI, Clerk keys, Razorpay keys
cp client/.env.example client/.env   # then edit VITE_CLERK_PUBLISHABLE_KEY

npm run dev:server      # terminal 1, API + sockets on :5000
npm run dev:client      # terminal 2, app on http://localhost:5173
```

To try a call you need **two users searching at the same time**: open the app in a normal window and an incognito window (or two browsers), register two accounts, give both some credits (buy with Razorpay test keys, or set `SIGNUP_CREDITS=10` in `server/.env` before registering), and press **Start video call** in both. They will be matched with each other.

> Browsers only allow camera/microphone on **HTTPS or localhost**. Testing from a phone on your LAN over plain `http://192.168.x.x` will be blocked; use a deployed HTTPS URL or a tunnel.

## Set up payments (Razorpay)

1. Create a free account at [razorpay.com](https://razorpay.com) and stay in **Test Mode** at first.
2. *Account & Settings → API Keys → Generate Test Key*. Put the values in `server/.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. Open the **Credits** page, pick a pack, and pay with Razorpay's test card/UPI details (shown in their docs). Credits appear instantly.
4. **Webhook (recommended):** in the Razorpay dashboard add a webhook to `https://YOUR-DOMAIN/api/payments/webhook`, enable `payment.captured` (and `order.paid`), and use the same secret as `RAZORPAY_WEBHOOK_SECRET`. This credits users who close the tab right after paying. Webhooks need a public URL, so set this up after you deploy.
5. In *Settings → Payment Capture*, keep **automatic capture** on. Otherwise payments stay "authorized" and are refunded after a few days.
6. To go live, complete Razorpay's KYC, then swap in the live keys (`rzp_live_...`).

Prices and packs are in `server/src/config.js`. The per-minute cost (`COST_VIDEO`) and free signup credits (`SIGNUP_CREDITS`) are env variables. The price is always set by the server; the browser only picks a pack ID.

How billing works: when two people are matched, **both** are charged the first minute, then both are charged again every 60 s. If either can't pay for the next minute, the call ends and the other person is refunded that minute. If a match falls through (someone disconnects), nobody is charged.

## How a call works

```
You                        Server (Socket.IO)                    Someone else
 |-- match:find ------------->|<------------------ match:find ----|   (both wait in a queue)
 |                            |  pairs two people, charges both   |
 |<- match:found (initiator) -|-- match:found -------------------->|
 |-- rtc:signal (offer) ----->|-- rtc:signal (offer) ------------->|
 |<- rtc:signal (answer) -----|<-- rtc:signal (answer) ------------|
 |<=========== rtc:signal (ICE candidates, both ways) ===========>|
 |<================== audio/video (peer-to-peer) ===============>|
 |-- call:end --------------->|-- call:ended --------------------->|
```

The server only relays small signaling messages. Once connected, media never touches it.

## Deploy (Render + MongoDB Atlas)

The server also serves the built React app, so everything runs as **one service on one HTTPS origin**.

1. **Database**: create a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas), add a database user, and under *Network Access* allow `0.0.0.0/0` (Render's free tier has no fixed IP). Copy the connection string (`mongodb+srv://...`).
2. **Push to GitHub**: `git init && git add . && git commit -m "Huddle"` and push to a new repo.
3. **Render**: *New → Blueprint*, pick the repo. `render.yaml` sets up the build/start commands. Paste your Atlas string, the Clerk keys (the publishable key goes in both `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY`) and the Razorpay keys when prompted. In Clerk, add your `*.onrender.com` (or custom) domain to the production instance.
4. Open the `*.onrender.com` URL. Register two accounts in two browsers and call.

Railway, Fly.io, or any Node host works the same way: build with `npm run build`, start with `npm start`, set `MONGODB_URI` and the Clerk keys (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `VITE_CLERK_PUBLISHABLE_KEY` at build time).

**Splitting client and server** (e.g. client on Vercel, API elsewhere): set `VITE_API_URL=https://your-api.example.com` when building the client, and `CLIENT_ORIGIN=https://your-client.example.com` on the server.

### Before real users

- **Add a TURN server.** WebRTC uses STUN to find a direct path, which works on most home networks. On strict corporate networks, some mobile carriers, and symmetric NATs a direct path is impossible and the call won't connect. Get a TURN relay from a provider (Twilio, Metered, Cloudflare, or self-host coturn) and set `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` on the server.
- **Add moderation.** Random video chat with strangers needs a way to report and block people, plus terms of use, before you open it to the public. This app does not include that yet.

## Known limits

- **You need at least two people searching at once.** With one user online they simply wait.
- **Single server instance.** Presence, the waiting queue and active calls are held in memory. To run several instances, add the Socket.IO Redis adapter and move that state into Redis.
- **One-to-one only.** Group calls would need an SFU (LiveKit, mediasoup).
- The server sets a strict Content-Security-Policy that allows Clerk's and Razorpay's scripts. If the sign-in box or payment window is blank on a deployed site, open the browser console, look for a "Content Security Policy" error naming a host, and add that host in `server/src/index.js`.
- Screen sharing is desktop-browser only (mobile browsers don't support `getDisplayMedia`).
- Free Render instances sleep when idle, so the first request after a pause is slow.
