import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Max base64-decoded size per screenshot (4 MB)
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Max number of screenshots per request
const MAX_SCREENSHOTS = 20;
// Max prompt text length
const MAX_PROMPT_CHARS = 50_000;

const SYSTEM_PROMPT = `You are helping draft an Ethos Slash report documenting reputation abuse (e.g. sybil behavior, review-for-review, vouch-for-vouch, or coordinated farming).

Goal:
Produce a clear, neutral, evidence-driven slash report suitable for on-chain posting. The tone should be factual, professional, and concise -- not emotional or speculative.

Instructions:
1. Structure
   - Start with a TLDR explaining why this is slash-worthy in 2-3 sentences.
   - Follow with clearly labeled sections:
     - Summary
     - Evidence (broken into numbered or titled subsections)
     - Conclusion

2. Evidence Handling
   - Only rely on evidence explicitly provided (links, screenshots, on-chain data, quotes).
   - Do not invent motives or facts.
   - If screenshots are referenced but not included, summarize what they show rather than quoting verbatim.
   - Clearly distinguish:
     - Social evidence (DMs, tweets, group posts)
     - On-chain evidence (wallet links, shared deposit addresses, first funders)
     - Behavioral patterns (timing, reciprocity, coordination)

3. Claims & Language
   - Use precise language like:
     - "demonstrates a pattern of"
     - "indicates coordinated behavior"
     - "shows intent to manipulate reputation signals"
   - Avoid insults, speculation, or moral judgments.
   - Frame conclusions as inferences based on evidence, not accusations.

4. Formatting
   - Use Markdown with headers (##, ###) and bullet points where helpful.
   - Keep paragraphs short and readable.
   - Do not use emojis.

5. On-Chain Compatibility
   - Assume the final output may be embedded in a JSON metadata field.
   - Avoid special characters that break encoding.
   - Use plain quotes (") and standard punctuation.

6. Scope
   - Do not include recommendations or penalties unless explicitly asked.
   - Focus strictly on documenting behavior and evidence.

Output Requirement:
- Return only the markdown slash report.
- Do not include commentary, explanations, or analysis outside the report itself.`;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  // Rate limit: 20 analyses per user per hour (Claude is expensive)
  if (!rateLimit(`analyze:${auth.profileId}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Analysis unavailable" }, { status: 500 });
  }

  let body: { prompt?: unknown; screenshots?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { prompt, screenshots } = body;

  if (typeof prompt !== "string") {
    return NextResponse.json({ error: "Invalid prompt" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "Prompt too large" }, { status: 413 });
  }

  if (screenshots !== undefined && !Array.isArray(screenshots)) {
    return NextResponse.json({ error: "Invalid screenshots" }, { status: 400 });
  }
  if (Array.isArray(screenshots) && screenshots.length > MAX_SCREENSHOTS) {
    return NextResponse.json(
      { error: `Too many screenshots (max ${MAX_SCREENSHOTS})` },
      { status: 413 }
    );
  }

  try {
    // Build message content: text + images
    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];
    content.push({ type: "text", text: prompt });

    // Add screenshots as images
    if (Array.isArray(screenshots)) {
      for (const screenshot of screenshots) {
        if (
          !screenshot ||
          typeof screenshot !== "object" ||
          typeof screenshot.dataUrl !== "string" ||
          typeof screenshot.address !== "string"
        ) {
          continue;
        }
        const match = screenshot.dataUrl.match(/^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/);
        if (!match) continue;

        // Validate decoded size (base64 is ~4/3 of binary)
        const base64 = match[3];
        const approxBytes = Math.floor((base64.length * 3) / 4);
        if (approxBytes > MAX_IMAGE_BYTES) {
          return NextResponse.json(
            { error: "Screenshot too large (max 4 MB)" },
            { status: 413 }
          );
        }

        content.push({
          type: "text",
          text: `\nX/Twitter search screenshot for wallet ${screenshot.address}:`,
        });
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: base64,
          },
        });
      }
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return NextResponse.json({ analysis: text });
  } catch (err) {
    // Log the real error server-side but don't leak it to the client
    console.error("/api/analyze error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
