# Sharing the Volkswagen Assistant demo

Use two links in the handoff email:

1. **Evaluator download** — the release page or file-share link containing `Volkswagen Assistant Demo.apk` and `EVALUATOR_README.md`.
2. **Source repository** — the GitHub repository URL for engineers who will iterate on and take over the prototype.

## Evaluator APK

The evaluator APK must be built with `EXPO_PUBLIC_TAKO_PROXY_URL` and `EXPO_PUBLIC_DEMO_ACCESS_TOKEN`. It then opens directly into the driver experience and only asks for Android microphone permission.

Do not bundle `TAKO_API_KEY` in the APK. The real key belongs only in the hosted relay's environment variables.

Before sending the APK:

- Confirm the relay health URL returns `{ "ok": true }`.
- Install the APK on a clean Android device.
- Approve microphone access and run at least one live question.
- Confirm the written answer is spoken and a returned card is displayed.
- Set an appropriate relay request limit and Tako credit budget.
- Record who can revoke the demo access token after evaluation.

## Source repository

The repository intentionally excludes `.env`, native build output, APKs, signing keys, and local Android tooling. The receiving team should create its own credentials and release signing configuration.

Recommended repository settings:

- Private visibility during evaluation
- Volkswagen and Tako engineering owners
- Branch protection on `main`
- GitHub Actions secrets named `DEMO_RELAY_URL` and `DEMO_ACCESS_TOKEN`
- No real Tako API key in GitHub Actions for the mobile build

The Tako key should be configured only on the relay hosting service.

## Suggested handoff note

> Attached is an installable Android evaluator build of the Volkswagen Assistant prototype. Install it on Android 7 or newer, allow microphone access, and tap to talk—no account or API-key setup is required. The source repository includes the React Native app, secure relay, build workflow, and takeover checklist. This is a prototype for evaluation rather than a production vehicle HMI.
