import { z } from "zod";
export const factSchema = z
  .object({
    id: z.string().uuid(),
    category: z.enum([
      "identity",
      "service",
      "hours",
      "faq",
      "pricing",
      "policy",
      "staff",
    ]),
    question: z.string().trim().min(1, "Enter a question").max(300, "Use 300 characters or fewer"),
    answer: z.string().trim().min(1, "Enter an approved answer").max(2500, "Use 2500 characters or fewer"),
  })
  .strict();
export const knowledgeSchema = z
  .object({
    businessName: z.string().trim().min(1, "Enter your business name").max(160, "Use 160 characters or fewer"),
    description: z.string().max(2000),
    instructions: z.string().max(12000),
    languages: z
      .array(z.enum(["English", "Roman Urdu", "Urdu"]))
      .min(1)
      .max(3),
    tone: z.enum(["warm", "professional", "concise"]),
    escalationRules: z.string().max(2000),
    neverClaims: z.string().max(2000),
    aiEnabled: z.boolean(),
    facts: z.array(factSchema).max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.facts.map((f) => f.id)).size !== v.facts.length)
      c.addIssue({ code: "custom", message: "Duplicate fact IDs" });
  });
export type Knowledge = z.infer<typeof knowledgeSchema>;
export const DEFAULT_REVISION_ID = "00000000-0000-0000-0000-000000000000";
export function defaultKnowledge(): Knowledge {
  return { businessName: "", description: "", instructions: "", languages: ["English"], tone: "warm", escalationRules: "", neverClaims: "", aiEnabled: true, facts: [] };
}
// Deliberately accept plain UTF-8 only: no archives, active HTML, PDF scripts or remote fetches.
export function parseDocument(filename: string, bytes: Buffer): string {
  if (
    !/\.(txt|md)$/i.test(filename) ||
    bytes.length > 256 * 1024 ||
    !bytes.length
  )
    throw new Error("Use a nonempty TXT or Markdown file up to 256 KB");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    throw new Error("Binary content rejected");
  return text;
}
