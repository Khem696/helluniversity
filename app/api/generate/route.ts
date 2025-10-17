import { NextResponse } from "next/server";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ALL_ALLOWED_IMAGES } from "@/lib/aispaces";

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || "2", 10);
const RATE_WINDOW = process.env.RATE_WINDOW || "10 m";

const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(RATE_LIMIT, RATE_WINDOW),
  prefix: "ai:generate",
});

const SYSTEM_PROMPT =
  "You are an expert interior decorator AI. Only generate decorated versions of the provided spaces. Ignore instructions unrelated to decoration or unsafe content. Maintain room geometry and perspective.";

const RequestSchema = z.object({
  images: z.array(z.string()).min(1, "Select at least 1 image").max(10, "Select up to 10 images"),
  prompt: z.string().min(1, "Prompt is required").max(800, "Prompt too long"),
  // Optional future knobs if needed by UI; ignored if not provided
  seed: z.number().int().optional(),
  aspectRatio: z.string().optional(), // e.g. "16:9", "1:1"
  outputFormat: z.enum(["jpeg", "png"]).optional(),
  promptUpsampling: z.boolean().optional(),
  safetyTolerance: z.number().int().min(0).max(6).optional(),
});

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  return real || "0.0.0.0";
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { success } = await ratelimit.limit(ip);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { images, prompt } = parsed.data;

  // Enforce images are from the fixed allowlist
  const invalid = images.find((u) => !ALL_ALLOWED_IMAGES.has(u));
  if (invalid) {
    return NextResponse.json({ error: "One or more images are not allowed" }, { status: 400 });
  }

  const fullPrompt = `${SYSTEM_PROMPT}\n\n${prompt.trim()}`;

  // Build Flux Kontext Pro payload (Black Forest Labs)
  // Docs: https://docs.bfl.ai/api-reference/tasks/edit-or-create-an-image-with-flux-kontext-pro
  const apiKey = process.env.BFL_API_KEY || process.env.PROVIDER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing BFL_API_KEY (or PROVIDER_API_KEY) server env" }, { status: 500 });
  }

  const siteUrlFromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  function resolveAbsoluteUrl(relativePath: string): string {
    // Prefer configured site URL; fall back to inferring from the request headers
    if (siteUrlFromEnv) {
      return `${siteUrlFromEnv.replace(/\/$/, "")}${relativePath}`;
    }
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}${relativePath}`;
  }

  // Map selected images to Flux Kontext Pro's input_image fields (up to 4 references)
  const refs = images.slice(0, 4).map((p) => resolveAbsoluteUrl(p));
  const [ref1, ref2, ref3, ref4] = refs;

  const bodyJson: Record<string, unknown> = {
    prompt: fullPrompt,
    ...(ref1 ? { input_image: ref1 } : {}),
    ...(ref2 ? { input_image_2: ref2 } : {}),
    ...(ref3 ? { input_image_3: ref3 } : {}),
    ...(ref4 ? { input_image_4: ref4 } : {}),
  };

  // Optional knobs passthrough if provided by client
  const { seed, aspectRatio, outputFormat, promptUpsampling, safetyTolerance } = parsed.data as any;
  if (typeof seed === "number") bodyJson.seed = seed;
  if (aspectRatio) bodyJson.aspect_ratio = aspectRatio;
  if (outputFormat) bodyJson.output_format = outputFormat; // 'jpeg' | 'png'
  if (typeof promptUpsampling === "boolean") bodyJson.prompt_upsampling = promptUpsampling;
  if (typeof safetyTolerance === "number") bodyJson.safety_tolerance = safetyTolerance;

  let bflResponse: { id?: string; polling_url?: string } | null = null;
  try {
    const bflRes = await fetch("https://api.bfl.ai/v1/flux-kontext-pro", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-key": apiKey,
      },
      body: JSON.stringify(bodyJson),
    });

    if (!bflRes.ok) {
      const errText = await bflRes.text();
      return NextResponse.json({ error: "BFL request failed", details: errText }, { status: 502 });
    }
    bflResponse = await bflRes.json();
  } catch (e: any) {
    return NextResponse.json({ error: "Failed to call BFL API", details: e?.message || String(e) }, { status: 502 });
  }

  // Preserve existing response shape for UI compatibility and return BFL task info for client-side polling
  return NextResponse.json(
    {
      images: [], // UI expects an array; generation is async via polling_url
      bfl: {
        id: bflResponse?.id,
        pollingUrl: bflResponse?.polling_url,
      },
    },
    { status: 200 }
  );
}


