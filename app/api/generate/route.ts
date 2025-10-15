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

  // TODO: Integrate with Flux Kontext or a compatible provider here.
  // For now, return placeholder images to complete the flow.
  const placeholder = "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&auto=format&fit=crop";
  const result = {
    images: images.map(() => placeholder),
  };

  return NextResponse.json(result, { status: 200 });
}


