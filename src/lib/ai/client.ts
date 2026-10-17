import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export type AiStep = "discovery" | "research" | "qualify";

const DEFAULT_MODEL = "claude-opus-5-5";

export function modelFor(step: AiStep): string {
  const override = {
    discovery: process.env.MODEL_DISCOVERY,
    research: process.env.MODEL_RESEARCH,
    qualify: process.env.MODEL_QUALIFY,
  }[step];
  return override || DEFAULT_MODEL;
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

export class AiRefusalError extends Error {}

type ServerTool = Anthropic.Beta.BetaToolUnion;

interface StructuredCallOptions<T extends z.ZodType> {
  step: AiStep;
  system: string;
  prompt: string;
  /** Name/description of the tool Claude calls to hand back its result. */
  resultTool: { name: string; description: string };
  schema: T;
  /** Anthropic server tools (e.g. web search) Claude may use before answering. */
  serverTools?: ServerTool[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

/**
 * Ask Claude for a structured result. The result comes back as the input of a
 * strict client tool, so it is schema-valid; we validate again with zod.
 * Works alongside server tools such as web search.
 */
export async function callStructured<T extends z.ZodType>(
  opts: StructuredCallOptions<T>,
): Promise<{ data: z.infer<T>; model: string }> {
  const model = modelFor(opts.step);
  const inputSchema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  delete inputSchema.$schema;

  const tools: Anthropic.Beta.BetaToolUnion[] = [
    ...(opts.serverTools ?? []),
    {
      name: opts.resultTool.name,
      description: opts.resultTool.description,
      input_schema: inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      strict: true,
    },
  ];

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];

  // Server-tool turns can pause; resume until Claude calls the result tool.
  for (let turn = 0; turn < 6; turn++) {
    const response = await getClient().beta.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages,
      tools,
      tool_choice: { type: "auto" },
      output_config: { effort: opts.effort ?? "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      throw new AiRefusalError(response.stop_details?.explanation ?? "Request declined");
    }

    const result = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === opts.resultTool.name,
    );
    if (result) {
      return { data: opts.schema.parse(result.input), model: response.model };
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    // Finished without calling the result tool: nudge once more.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: `Call the ${opts.resultTool.name} tool now with your result.`,
    });
  }
  throw new Error(`Claude did not return a ${opts.resultTool.name} result`);
}
