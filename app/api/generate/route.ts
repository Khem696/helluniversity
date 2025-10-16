import { NextResponse } from "next/server";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ALL_ALLOWED_IMAGES } from "@/lib/aispaces";
import path from "path";
import fs from "fs/promises";

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

  const hfUrl = process.env.HF_API_URL;
  const hfToken = process.env.HF_API_TOKEN;
  const useControlNetDepth = (process.env.HF_USE_CONTROLNET_DEPTH || "false").toLowerCase() === "true";
  const steps = parseInt(process.env.HF_STEPS || "28", 10);
  const guidanceScale = parseFloat(process.env.HF_GUIDANCE_SCALE || "5");
  const strength = parseFloat(process.env.HF_DENOISE_STRENGTH || "0.3");

  // Require both URL and token for secured backend
  if (!hfUrl || !hfToken) {
    return NextResponse.json({ error: "Generation backend not configured" }, { status: 500 });
  }

  // Attempt to call secured backend
  if (hfUrl && hfToken) {
    try {
      // Load selected allowlisted images from public/ into base64 data URLs
      const dataUrls: string[] = [];
      for (const rel of images) {
        // harden path to only serve files inside public
        const safeRel = rel.startsWith("/") ? rel : `/${rel}`;
        const abs = path.join(process.cwd(), "public", safeRel);
        const buf = await fs.readFile(abs);
        // naive mime detection by extension
        const ext = path.extname(abs).toLowerCase();
        const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        const b64 = buf.toString("base64");
        dataUrls.push(`data:${mime};base64,${b64}`);
      }

      // For now, send one image at a time and return one output per input.
      // Many endpoints accept a single image. We'll call sequentially to keep it simple and robust.
      const generated: string[] = [];
      for (const dataUrl of dataUrls) {
        const payload: Record<string, unknown> = {
          prompt: fullPrompt,
          image: dataUrl, // init image for img2img
          num_inference_steps: steps,
          guidance_scale: guidanceScale,
          strength,
          use_controlnet_depth: useControlNetDepth,
        };

        const headers: Record<string, string> = { "Content-Type": "application/json", "Authorization": `Bearer ${hfToken}` };
        const res = await fetch(hfUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HF endpoint error: ${res.status} ${errText}`);
        }

        // Try to parse JSON first (common for custom endpoints). If it fails, assume binary image.
        let outputUrlOrB64: string | null = null;
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const out = await res.json();
          // Accept a few common shapes: { images: [..] } | { image: ".." } | { output: ".." }
          if (Array.isArray(out?.images) && out.images.length > 0) {
            outputUrlOrB64 = String(out.images[0]);
          } else if (typeof out?.image === "string") {
            outputUrlOrB64 = out.image;
          } else if (typeof out?.output === "string") {
            outputUrlOrB64 = out.output;
          }
        } else if (contentType.startsWith("image/")) {
          const arrBuf = await res.arrayBuffer();
          const b64 = Buffer.from(arrBuf).toString("base64");
          outputUrlOrB64 = `data:${contentType};base64,${b64}`;
        }

        if (!outputUrlOrB64) {
          throw new Error("Unexpected HF response format");
        }

        generated.push(outputUrlOrB64);
      }

      return NextResponse.json({ images: generated }, { status: 200 });
    } catch (err) {
      console.error("HF generation failed", err);
      return NextResponse.json({ error: "Generation failed" }, { status: 500 });
    }
  }
}


