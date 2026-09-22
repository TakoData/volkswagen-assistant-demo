const path = require("path");
const crypto = require("crypto");

// Keep the API key outside the mobile project. The parent workspace already
// contains the local Tako credentials used by the other demos.
require("dotenv").config({
  path: [
    path.resolve(__dirname, "../.env.local"),
    path.resolve(__dirname, "../.env"),
  ]
});

const cors = require("cors");
const express = require("express");

const app = express();
const port = Number(process.env.PORT || 8787);
const takoUrl = process.env.TAKO_API_URL || "https://tako.com/api/v1/answer";
const vehicleLocation = { latitude: 52.4227, longitude: 10.7865 };

function isWeatherQuery(query) {
  return /\b(weather|forecast|temperature|rain|snow|sunny|wind|humidity)\b/i.test(query);
}

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));

const requestsByClient = new Map();
const rateLimit = Number(process.env.DEMO_RATE_LIMIT_PER_HOUR || 60);

function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function authorizeDemo(request, response, next) {
  const expectedToken = process.env.DEMO_ACCESS_TOKEN;
  if (!expectedToken) {
    return response.status(503).json({ error: "The demo relay is not configured." });
  }

  const authorization = request.get("authorization") || "";
  const receivedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!tokenMatches(receivedToken, expectedToken)) {
    return response.status(401).json({ error: "This demo build is not authorized." });
  }

  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const clientId = request.ip || request.socket.remoteAddress || "unknown";
  const recentRequests = (requestsByClient.get(clientId) || []).filter((timestamp) => timestamp > windowStart);
  if (recentRequests.length >= rateLimit) {
    response.set("Retry-After", "3600");
    return response.status(429).json({ error: "This demo has reached its hourly request limit." });
  }
  recentRequests.push(now);
  requestsByClient.set(clientId, recentRequests);
  return next();
}

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "vw-tako-proxy" });
});

app.post("/answer", authorizeDemo, async (request, response) => {
  const query = typeof request.body?.query === "string" ? request.body.query.trim() : "";
  if (!query || query.length > 500) {
    return response.status(400).json({ error: "Query must be between 1 and 500 characters." });
  }

  if (process.env.DEMO_MODE === "true") {
    return response.json({
      answer:
        "Nvidia has grown to about 36,000 full-time employees as of the end of 2024, up roughly 309 percent from about 8,800 in 2013. AMD reached about 28,000 over the same period.",
      cards: [
        {
          id: "demo-headcount",
          title: "Nvidia and AMD headcount since 2013",
          embed_url: "https://tako.com/embed/geYufvSx04pyWX7GpHeR/",
          sources: ["Tako"]
        }
      ],
      request_id: "demo-request"
    });
  }

  const apiKey = process.env.TAKO_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "TAKO_API_KEY is not configured on the proxy." });
  }

  try {
    const weatherQuery = isWeatherQuery(query);
    const upstream = await fetch(takoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey
      },
      body: JSON.stringify({
        query,
        effort: "fast",
        ...(weatherQuery ? {
          sources: {
            data: { count: 10 },
            web: { count: 10 }
          }
        } : {}),
        location: vehicleLocation,
        country_code: "DE",
        locale: "en-US",
        timezone: "Europe/Berlin",
        output_settings: { image_dark_mode: true }
      }),
      signal: AbortSignal.timeout(28_000)
    });

    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const message = payload?.error_message || payload?.error || `Tako returned ${upstream.status}`;
      return response.status(upstream.status).json({ error: message });
    }
    return response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tako request failed";
    return response.status(502).json({ error: message });
  }
});

if (require.main === module) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`VW × Tako proxy listening on http://0.0.0.0:${port}`);
  });
}

module.exports = app;
