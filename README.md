# $PAINT Masterpiece Generator

Single-page Next.js app that:
- accepts one uploaded image,
- sends it to WaveSpeed model API,
- polls task status and returns generated output to the same requester,
- rate limits users to 3 generations/day per IP using Vercel KV,
- adds `$PAINT` watermark on client-side canvas,
- includes a one-click "Share on X" button.

## 1) Install

```bash
npm install
```

## 2) Environment variables

Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required:
- `WAVESPEED_API_KEY`
- `WAVESPEED_MODEL` (optional, default: `openai/gpt-image-2/edit`)
- `SITE_URL` (for OpenRouter referer + X share text)
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Important:
- `WAVESPEED_API_KEY` must be a WaveSpeed key from `wavespeed.ai/accesskey` (not an OpenRouter `sk-or-v1` key).

## 3) Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## 4) Deploy to everyone (GitHub + Vercel)

1. Push this folder to a GitHub repo.
2. Import repo in Vercel.
3. In Vercel dashboard, add KV storage (Upstash via Vercel KV integration).
4. Set env vars in Project Settings -> Environment Variables:
   - `WAVESPEED_API_KEY`
   - `WAVESPEED_MODEL` (optional)
   - `SITE_URL`
5. Redeploy.

Vercel automatically injects `KV_REST_API_URL` + `KV_REST_API_TOKEN` after KV integration.

## 5) API behavior

Endpoint: `POST /api/generate`

- Input: multipart form-data with `image` file
- Per-IP daily limit: 3
- On limit exceeded: HTTP 429 with:
  - `"Daily limit of 3 generations reached."`
- Returns:
  - `imageUrl` (generated URL from WaveSpeed outputs)
  - `imageDataUrl` (base64 image returned through backend for stable client rendering)
