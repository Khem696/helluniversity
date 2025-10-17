import { NextResponse } from "next/server";

function getPollingUrlFromRequest(req: Request): string | null {
  try {
    const url = new URL(req.url);
    const pollingUrl = url.searchParams.get("pollingUrl");
    return pollingUrl;
  } catch {
    return null;
  }
}

function extractImages(payload: any): string[] {
  if (!payload || typeof payload !== "object") return [];

  // Direct images array
  if (Array.isArray(payload.images) && payload.images.every((x: any) => typeof x === "string")) {
    return payload.images as string[];
  }
  // Single image field
  if (typeof payload.image === "string") {
    return [payload.image as string];
  }
  // Common nesting shapes
  if (payload.result) {
    const r = payload.result;
    if (Array.isArray(r.images) && r.images.every((x: any) => typeof x === "string")) return r.images as string[];
    if (typeof r.image === "string") return [r.image as string];
    if (Array.isArray(r.output)) {
      const urls = r.output
        .map((o: any) => (typeof o?.image === "string" ? o.image : typeof o?.image_url === "string" ? o.image_url : null))
        .filter(Boolean);
      if (urls.length > 0) return urls as string[];
    }
  }
  if (Array.isArray(payload.output)) {
    const urls = payload.output
      .map((o: any) => (typeof o?.image === "string" ? o.image : typeof o?.image_url === "string" ? o.image_url : null))
      .filter(Boolean);
    if (urls.length > 0) return urls as string[];
  }
  return [];
}

export async function GET(req: Request) {
  const pollingUrl = getPollingUrlFromRequest(req);
  if (!pollingUrl) {
    return NextResponse.json({ error: "Missing pollingUrl query param" }, { status: 400 });
  }

  const apiKey = process.env.BFL_API_KEY || process.env.PROVIDER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing BFL_API_KEY (or PROVIDER_API_KEY) server env" }, { status: 500 });
  }

  try {
    const res = await fetch(pollingUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-key": apiKey,
      },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: "BFL polling request failed", details: data }, { status: 502 });
    }

    const images = extractImages(data);
    const status = (data?.status as string) || (images.length > 0 ? "completed" : "running");

    return NextResponse.json(
      {
        status,
        images,
        raw: data,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: "Failed to poll BFL API", details: e?.message || String(e) }, { status: 502 });
  }
}


