import {
  InferenceClient,
  InferenceClientProviderApiError,
  INFERENCE_PROVIDERS,
} from "@huggingface/inference";
import type { InferenceProviderOrPolicy } from "@huggingface/inference";
import type { Config } from "../config.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const PROVIDER_TRY_ORDER = [
  "nebius",
  "together",
  "featherless-ai",
  "deepinfra",
  "fireworks-ai",
  "groq",
  "cerebras",
  "hf-inference",
] as const satisfies readonly (typeof INFERENCE_PROVIDERS)[number][];

const CHAT_TASKS = new Set(["conversational", "text-generation"]);

type MappingEntry = {
  provider: string;
  providerId: string;
  status: string;
  task: string;
};

function normalizeInferenceMapping(
  modelId: string,
  inferenceProviderMapping: unknown
): MappingEntry[] {
  if (!inferenceProviderMapping) return [];
  if (Array.isArray(inferenceProviderMapping)) {
    return inferenceProviderMapping as MappingEntry[];
  }
  if (typeof inferenceProviderMapping !== "object") return [];
  return Object.entries(inferenceProviderMapping as Record<string, { providerId: string; status: string; task: string }>).map(
    ([provider, m]) => ({
      provider,
      providerId: m.providerId,
      status: m.status,
      task: m.task,
    })
  );
}

const knownProviders = new Set<string>(INFERENCE_PROVIDERS as unknown as string[]);

/**
 * Live providers for this model that support chat-style tasks, ordered for fallback retries.
 */
async function getSortedChatProviders(modelId: string, accessToken: string): Promise<string[]> {
  const url = `https://huggingface.co/api/models/${encodeURIComponent(modelId)}?expand[]=inferenceProviderMapping`;
  const res = await fetch(url, {
    headers: accessToken.startsWith("hf_") ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { inferenceProviderMapping?: unknown };
  const list = normalizeInferenceMapping(modelId, data.inferenceProviderMapping);
  const live = list.filter((m) => m.status === "live" && CHAT_TASKS.has(m.task));
  const providers = [...new Set(live.map((m) => m.provider))].filter((p) => knownProviders.has(p));

  const ranked = [
    ...PROVIDER_TRY_ORDER.filter((p) => providers.includes(p)),
    ...providers.filter((p) => !PROVIDER_TRY_ORDER.includes(p as (typeof PROVIDER_TRY_ORDER)[number])),
  ];
  return ranked;
}

function rethrowWithDetails(err: unknown): Error {
  if (err instanceof InferenceClientProviderApiError) {
    const body =
      typeof err.httpResponse.body === "object" && err.httpResponse.body !== null
        ? JSON.stringify(err.httpResponse.body)
        : String(err.httpResponse.body);
    return new Error(`${err.message} (HTTP ${err.httpResponse.status}) ${body}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function shouldRetryOtherProviders(err: unknown): boolean {
  if (!(err instanceof InferenceClientProviderApiError)) return false;
  const s = err.httpResponse.status;
  if (s === 401 || s === 403) return false;
  return true;
}

export function createInferenceClient(config: Config): InferenceClient {
  return new InferenceClient(config.HF_TOKEN);
}

export async function completeChat(
  client: InferenceClient,
  config: Config,
  messages: ChatMessage[]
): Promise<string> {
  const base = {
    model: config.HF_MODEL,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    max_tokens: 400,
    temperature: 0.65,
  };

  const explicit =
    config.HF_PROVIDER && config.HF_PROVIDER.trim() !== "" && config.HF_PROVIDER !== "auto"
      ? config.HF_PROVIDER
      : undefined;

  type Attempt = { label: string; args: Parameters<InferenceClient["chatCompletion"]>[0] };

  const attempts: Attempt[] = explicit
    ? [
        {
          label: `provider=${explicit}`,
          args: {
            ...base,
            provider: explicit as InferenceProviderOrPolicy,
          },
        },
      ]
    : [
        { label: "router(auto)", args: { ...base } },
        ...(await getSortedChatProviders(config.HF_MODEL, config.HF_TOKEN)).map((p) => ({
          label: `provider=${p}`,
          args: { ...base, provider: p as InferenceProviderOrPolicy },
        })),
      ];

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const { label, args } = attempts[i]!;
    try {
      const out = await client.chatCompletion(args);
      const text = out.choices[0]?.message?.content?.trim();
      if (!text) throw new Error("Empty model response");
      return text;
    } catch (e) {
      lastErr = e;
      const isLast = i === attempts.length - 1;
      if (explicit || isLast || !shouldRetryOtherProviders(e)) {
        throw rethrowWithDetails(e);
      }
      const brief =
        e instanceof InferenceClientProviderApiError
          ? `HTTP ${e.httpResponse.status}`
          : e instanceof Error
            ? e.message
            : String(e);
      console.warn(`[hfInference] ${label} failed (${brief}), trying next…`);
    }
  }

  throw rethrowWithDetails(lastErr);
}
