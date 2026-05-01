import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";

const LOCAL_WINDOW_SECONDS = 60 * 60 * 24;
const WAVESPEED_BASE_URL = "https://api.wavespeed.ai/api/v3";
const WAVESPEED_DEFAULT_MODEL = "openai/gpt-image-2/edit";
const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 300_000;

export const maxDuration = 300;

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return realIp || "unknown";
}

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function saveJobState(requestId: string, payload: Record<string, unknown>) {
  if (!hasKvConfig()) return;
  const key = `paint:job:${requestId}`;
  await kv.set(key, payload, { ex: LOCAL_WINDOW_SECONDS });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractWaveSpeedOutputUrl(payload: any) {
  const outputs = payload?.data?.outputs;
  if (Array.isArray(outputs) && typeof outputs[0] === "string") {
    return outputs[0];
  }
  if (Array.isArray(outputs) && outputs[0]?.url) {
    return outputs[0].url as string;
  }
  if (typeof payload?.data?.output === "string") {
    return payload.data.output as string;
  }
  if (payload?.data?.output?.url) {
    return payload.data.output.url as string;
  }
  return null;
}

function isTransientFetchError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("terminated") ||
    message.includes("econnreset") ||
    message.includes("timeout") ||
    message.includes("network")
  );
}

async function submitWaveSpeedTask({
  apiKey,
  model,
  prompt,
  imageDataUrl
}: {
  apiKey: string;
  model: string;
  prompt: string;
  imageDataUrl: string;
}) {
  const submitUrl = `${WAVESPEED_BASE_URL}/${model}`;
  const response = await fetch(submitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      images: [imageDataUrl],
      image: imageDataUrl,
      image_url: imageDataUrl,
      input_image: imageDataUrl,
      num_images: 1,
      enable_sync_mode: false,
      enable_base64_output: false
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error?.message ||
      "WaveSpeed task submission failed.";
    throw new Error(message);
  }

  const taskId = payload?.data?.id as string | undefined;
  const getUrl = payload?.data?.urls?.get as string | undefined;
  if (!taskId && !getUrl) {
    throw new Error("WaveSpeed did not return task id.");
  }

  return {
    taskId,
    pollUrl: getUrl || `${WAVESPEED_BASE_URL}/predictions/${taskId}`
  };
}

async function waitForWaveSpeedResult({
  apiKey,
  pollUrl
}: {
  apiKey: string;
  pollUrl: string;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    let response: Response;
    let payload: any;
    try {
      response = await fetch(pollUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        cache: "no-store"
      });
      payload = await response.json().catch(() => ({}));
    } catch (error) {
      if (isTransientFetchError(error)) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.error?.message ||
        "WaveSpeed polling failed.";
      throw new Error(message);
    }

    const status = String(payload?.data?.status || "").toLowerCase();
    if (status === "completed" || status === "succeeded" || status === "success") {
      const outputUrl = extractWaveSpeedOutputUrl(payload);
      if (!outputUrl) {
        throw new Error("WaveSpeed completed without output URL.");
      }
      return outputUrl;
    }

    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
      const errorMessage =
        payload?.data?.error ||
        payload?.message ||
        "WaveSpeed task failed.";
      throw new Error(errorMessage);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Generation timed out while waiting for WaveSpeed result.");
}

export async function POST(request: Request) {
  try {
    const wavespeedApiKey =
      process.env.WAVESPEED_API_KEY || process.env.OPENROUTER_API_KEY;

    if (!wavespeedApiKey) {
      return NextResponse.json(
        { error: "Missing WAVESPEED_API_KEY (or OPENROUTER_API_KEY fallback) in environment variables." },
        { status: 500 }
      );
    }
    if (wavespeedApiKey.startsWith("sk-or-v1-")) {
      return NextResponse.json(
        {
          error:
            "Detected an OpenRouter-style key (sk-or-v1). For WaveSpeed API you must use a WaveSpeed key from https://wavespeed.ai/accesskey with active balance."
        },
        { status: 401 }
      );
    }

    const requestId = crypto.randomUUID();
    const ip = getClientIp(request);

    const formData = await request.formData();
    const file = formData.get("image");
    const promptText =
      "Redraw the attached image in the most clumsy, scribbly, and utterly pathetic way possible. Use a white background, and make it look like it was drawn in MS Paint with a mouse. It should be vaguely similar but also not really, kind of matching but also off in a confusing, awkward way, with that low-quality pixel-by-pixel feel that really emphasizes how ridiculously bad it is. Actually, you know what, whatever, just draw it however you want.";

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Please upload one image file." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Image = buffer.toString("base64");
    const mimeType = file.type || "image/png";
    const model = process.env.WAVESPEED_MODEL || WAVESPEED_DEFAULT_MODEL;
    const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

    await saveJobState(requestId, {
      requestId,
      ip,
      status: "submitting",
      model,
      createdAt: new Date().toISOString()
    });

    const task = await submitWaveSpeedTask({
      apiKey: wavespeedApiKey,
      model,
      prompt: promptText,
      imageDataUrl
    });

    await saveJobState(requestId, {
      requestId,
      ip,
      status: "processing",
      model,
      taskId: task.taskId ?? null,
      pollUrl: task.pollUrl,
      createdAt: new Date().toISOString()
    });

    const imageUrl = await waitForWaveSpeedResult({
      apiKey: wavespeedApiKey,
      pollUrl:
        task.pollUrl ||
        `${WAVESPEED_BASE_URL}/predictions/${task.taskId}/result`
    });
    const imageProxyUrl = `/api/image?url=${encodeURIComponent(imageUrl)}`;

    await saveJobState(requestId, {
      requestId,
      ip,
      status: "completed",
      model,
      taskId: task.taskId ?? null,
      imageUrl,
      completedAt: new Date().toISOString()
    });

    return NextResponse.json({
      imageUrl,
      imageDataUrl: null,
      imageProxyUrl,
      taskId: task.taskId ?? null,
      requestId
    });
  } catch (error) {
    console.error("Generate API error:", error);
    const message =
      error instanceof Error ? error.message : "Unexpected server error while generating image.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
