import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { prompt, screenshots } = await req.json();

    // Build message content: text + images
    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

    // Add the evidence data as text
    content.push({ type: "text", text: prompt });

    // Add screenshots as images
    if (screenshots && Array.isArray(screenshots)) {
      for (const screenshot of screenshots) {
        if (screenshot.dataUrl && screenshot.address) {
          const match = screenshot.dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            content.push({
              type: "text",
              text: `\nX/Twitter search screenshot for wallet ${screenshot.address}:`,
            });
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: match[2],
              },
            });
          }
        }
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
    const errorMessage = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
