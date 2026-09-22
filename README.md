# Volkswagen Assistant Android demo

A landscape React Native Android prototype for a Volkswagen-style in-car assistant. Drivers tap to talk, the app sends the transcript to Tako Answer, reads the written answer aloud, and presents the lead knowledge card in a dark, glanceable layout.

## What is included

- Native Android speech recognition with live voice feedback
- Tako Answer text-to-speech playback
- Glanceable dark-mode knowledge cards
- Vehicle-location grounding for current weather and other implicit-location questions
- A zero-setup evaluator mode backed by a hosted relay
- A direct mode with one-time, hidden administrator key setup
- A small Express relay that keeps the real Tako API key off shared devices

## Architecture

```text
Android speech recognition
          ↓
Volkswagen Assistant app ── bearer demo token ──→ hosted relay ── Tako API key ──→ Tako Answer
          ↑                                                        │
          └──── Android TTS + glanceable card ←────────────────────┘
```

The bearer token in an evaluator APK is deliberately revocable and rate-limited; it is not the Tako API key. Never place `TAKO_API_KEY` in an `EXPO_PUBLIC_*` variable or in an APK.

## Run locally

Prerequisites: Node 20.19.4+ (or another version accepted by `package.json`), JDK 17, Android Studio, and an Android device or emulator.

```bash
npm install
npm run android
```

Without relay variables, the app uses direct mode. Long-press the Volkswagen logo, enter a Tako API key once, and tap **Save and continue**. Android stores the key in encrypted credential storage; the normal driver UI never shows setup.

## Run with the local relay

Copy `.env.example` to `.env`, provide the server-only values, then start the relay:

```bash
npm run server
```

For an emulator, set `EXPO_PUBLIC_TAKO_PROXY_URL=http://10.0.2.2:8787`. For a physical device, use your Mac's LAN IP. The server and app must use the same demo access token.

## Build the zero-setup evaluator APK

Deploy the relay first, then build with its HTTPS URL and the matching revocable token:

```bash
EXPO_PUBLIC_TAKO_PROXY_URL=https://your-relay.example.com \
EXPO_PUBLIC_DEMO_ACCESS_TOKEN=your-revocable-demo-token \
npx expo prebuild --platform android --clean

cd android
./gradlew assembleRelease
```

The APK is written under `android/app/build/outputs/apk/release/`. This internal-demo build uses Android's debug signing key so it can be sideloaded. Before Play Store, MDM, or production distribution, configure a Volkswagen-owned release keystore and application ID.

## Deploy the relay

The included `vercel.json` supports a Vercel deployment. Configure these server-side environment variables on the hosting service:

- `TAKO_API_KEY` — the real Tako key; server only
- `DEMO_ACCESS_TOKEN` — a long, random, revocable token
- `DEMO_RATE_LIMIT_PER_HOUR` — defaults to 60
- `TAKO_API_URL` — optional; defaults to `https://tako.com/api/v1/answer`

The health endpoint is `GET /health`; app requests use `POST /answer`.

## Repository takeover checklist

1. Clone the repository and run `npm install`.
2. Create fresh Tako and demo access tokens; do not reuse the prototype owner's credentials.
3. Deploy the relay in Volkswagen-controlled infrastructure.
4. Set the GitHub Actions secrets `DEMO_RELAY_URL` and `DEMO_ACCESS_TOKEN` to produce evaluator APK artifacts.
5. Replace the package ID, signing key, and text-only VW placeholder with Volkswagen-owned production values/assets.
6. Complete security, privacy, accessibility, and driver-distraction reviews before vehicle use.

## Important scope notes

- This is a prototype, not a production vehicle HMI.
- The “VW” mark is a text treatment, not an official Volkswagen asset.
- Speech recognition behavior depends on the Android device and installed speech services.
- The in-memory relay rate limiter is appropriate for a controlled demo. A production deployment should use durable, centrally enforced quotas and authenticated Volkswagen users/devices.
