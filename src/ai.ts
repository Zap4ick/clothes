import OpenAI from "openai";
import { buildWeatherExtractionPrompt, type WeatherIntent } from "./prompts";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

let cachedClients: OpenAI[] | null = null;
let preferredEndpoint: string | null = null;
const warnedGeminiEndpointNormalizations = new Set<string>();

type EndpointSource = "local" | "external";

interface EndpointConfig {
  baseURL: string;
  source: EndpointSource;
}

function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

function splitEndpoints(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((endpoint) => endpoint.trim())
    .filter(Boolean);
}

function uniqueEndpoints(endpoints: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const endpoint of endpoints) {
    if (!seen.has(endpoint)) {
      seen.add(endpoint);
      result.push(endpoint);
    }
  }
  return result;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeExternalBaseURL(baseURL: string): string {
  const trimmed = trimTrailingSlash(baseURL.trim());
  if (!trimmed) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (url.hostname !== "generativelanguage.googleapis.com") {
    return trimmed;
  }

  const path = trimTrailingSlash(url.pathname);
  if (path === "/v1beta/models") {
    url.pathname = "/v1beta/openai";
  } else if (path === "/v1/models") {
    url.pathname = "/v1/openai";
  } else if (path === "/v1beta") {
    url.pathname = "/v1beta/openai";
  } else if (path === "/v1") {
    url.pathname = "/v1/openai";
  }

  return trimTrailingSlash(url.toString());
}

function getEndpointList(): EndpointConfig[] {
  const localEndpoints = uniqueEndpoints([
    ...splitEndpoints(process.env.LOCAL_AI_BASE_URLS),
    ...(process.env.LOCAL_AI_BASE_URL ? [process.env.LOCAL_AI_BASE_URL] : []),
    "http://localhost:1234/v1",
  ])
    .map((baseURL) => trimTrailingSlash(baseURL))
    .map((baseURL) => ({ baseURL, source: "local" as const }));

  const externalEndpointsRaw = uniqueEndpoints([
    ...splitEndpoints(process.env.EXTERNAL_AI_BASE_URLS),
    ...(process.env.EXTERNAL_AI_BASE_URL
      ? [process.env.EXTERNAL_AI_BASE_URL]
      : []),
  ]);

  const externalEndpoints: EndpointConfig[] = [];
  for (const baseURL of externalEndpointsRaw) {
    const normalizedBaseURL = normalizeExternalBaseURL(baseURL);
    if (
      normalizedBaseURL !== trimTrailingSlash(baseURL) &&
      !warnedGeminiEndpointNormalizations.has(baseURL)
    ) {
      warnedGeminiEndpointNormalizations.add(baseURL);
      console.warn(
        dim(
          `[AI config] Rewriting Gemini endpoint ${baseURL} to ${normalizedBaseURL} for OpenAI SDK compatibility.`,
        ),
      );
    }
    externalEndpoints.push({
      baseURL: normalizedBaseURL,
      source: "external" as const,
    });
  }

  return [...localEndpoints, ...externalEndpoints];
}

function createClientForEndpoint(endpoint: EndpointConfig): OpenAI {
  if (endpoint.source === "external") {
    return new OpenAI({
      baseURL: endpoint.baseURL,
      apiKey: process.env.EXTERNAL_AI_API_KEY ?? "",
    });
  }

  return new OpenAI({
    baseURL: endpoint.baseURL,
    apiKey: "lm-studio",
  });
}

function getClients(): OpenAI[] {
  if (cachedClients) {
    return cachedClients;
  }

  const endpoints = getEndpointList();
  if (endpoints.length === 0) {
    throw new Error("No AI endpoints configured.");
  }

  cachedClients = endpoints.map(createClientForEndpoint);
  return cachedClients;
}

function isFailoverError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes("connection error") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  );
}

function summarizeError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

async function withEndpointFailover<T>(
  fn: (client: OpenAI, endpoint: EndpointConfig) => Promise<T>,
): Promise<T> {
  const endpoints = getEndpointList();
  const clients = getClients();
  let lastError: unknown;
  if (
    preferredEndpoint &&
    !endpoints.some((endpoint) => endpoint.baseURL === preferredEndpoint)
  ) {
    preferredEndpoint = null;
  }

  const previousPreferredEndpoint = preferredEndpoint;
  const startIndex = preferredEndpoint
    ? Math.max(
        0,
        endpoints.findIndex(
          (endpoint) => endpoint.baseURL === preferredEndpoint,
        ),
      )
    : 0;

  if (clients.length > 1 && preferredEndpoint && startIndex > 0) {
    console.log(
      dim(
        `[AI failover] Using preferred endpoint ${preferredEndpoint} as first choice.`,
      ),
    );
  }

  const attemptOrder = Array.from({ length: clients.length }, (_, offset) => {
    return (startIndex + offset) % clients.length;
  });

  for (let attempt = 0; attempt < attemptOrder.length; attempt += 1) {
    const index = attemptOrder[attempt];
    const endpoint = endpoints[index];
    try {
      const result = await fn(clients[index], endpoint);
      preferredEndpoint = endpoint?.baseURL ?? null;
      if (
        clients.length > 1 &&
        preferredEndpoint &&
        preferredEndpoint !== previousPreferredEndpoint
      ) {
        console.log(
          dim(
            `[AI failover] Preferred endpoint updated to ${preferredEndpoint}.`,
          ),
        );
      }
      return result;
    } catch (err: unknown) {
      lastError = err;
      const isLast = attempt === attemptOrder.length - 1;
      if (!isFailoverError(err) || isLast) {
        throw err;
      }

      const currentEndpoint = endpoint?.baseURL ?? "(unknown endpoint)";
      const nextIndex = attemptOrder[attempt + 1];
      const nextEndpoint =
        nextIndex !== undefined
          ? (endpoints[nextIndex]?.baseURL ?? "(unknown endpoint)")
          : "(no next endpoint)";
      console.warn(
        dim(
          `[AI failover] Request failed on ${currentEndpoint}
  ↳ ${summarizeError(err)}
  ↳ switching to ${nextEndpoint}`,
        ),
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI request failed on all configured endpoints.");
}

export function createClient(): OpenAI {
  return getClients()[0];
}

function parseTimeoutMs(
  rawValue: string | undefined,
  fallback: number,
): number {
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getAvailabilityTimeoutMs(): number {
  return parseTimeoutMs(
    process.env.AI_AVAILABILITY_TIMEOUT_MS ?? process.env.AI_TIMEOUT_MS,
    12000,
  );
}

function getResponseTimeoutMs(): number {
  return parseTimeoutMs(
    process.env.AI_RESPONSE_TIMEOUT_MS ?? process.env.AI_TIMEOUT_MS,
    45000,
  );
}

async function resolveModel(
  client: OpenAI,
  endpoint: EndpointConfig,
  requestOptions?: { timeout: number; maxRetries: number },
): Promise<string> {
  // External endpoints always require an explicit model name
  if (endpoint.source === "external") {
    const model = process.env.EXTERNAL_AI_MODEL;
    if (!model)
      throw new Error(
        "EXTERNAL_AI_MODEL must be set when using an external endpoint.",
      );
    return model;
  }

  // LM Studio: use override if set, otherwise auto-detect
  const override = process.env.LOCAL_AI_MODEL;
  if (override) return override;

  const list = await client.models.list(requestOptions);
  const first = list.data[0]?.id;
  if (!first)
    throw new Error(
      "No models loaded in LM Studio. Load a model and start the server.",
    );
  return first;
}

export async function preflightAI(client: OpenAI): Promise<string> {
  const requestOptions = { timeout: getAvailabilityTimeoutMs(), maxRetries: 0 };
  return withEndpointFailover(async (activeClient, endpoint) => {
    const model = await resolveModel(activeClient, endpoint, requestOptions);
    await activeClient.models.retrieve(model, requestOptions);
    return model;
  });
}

export interface ChatResult {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  elapsedMs: number;
}

export type StreamContentCallback = (delta: string) => void;

export interface WeatherIntentResult {
  intent: WeatherIntent | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  elapsedMs: number;
}

const WEATHER_LOCATION_PREFIX_WORDS = new Set([
  "go",
  "going",
  "travel",
  "traveling",
  "travelling",
  "visit",
  "visiting",
  "plan",
  "planning",
  "head",
  "heading",
  "drive",
  "driving",
  "fly",
  "flying",
]);

const WEATHER_DATE_WORDS = new Set([
  "today",
  "tonight",
  "tomorrow",
  "weekend",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "week",
]);

function normalizeWeatherLocation(rawLocation: string | null): string | null {
  if (!rawLocation) {
    return null;
  }

  const tokens = rawLocation.trim().split(/\s+/).filter(Boolean);

  while (
    tokens.length > 0 &&
    WEATHER_LOCATION_PREFIX_WORDS.has(tokens[0].toLowerCase())
  ) {
    tokens.shift();
  }

  while (
    tokens.length > 0 &&
    ["to", "in", "for", "at", "near"].includes(tokens[0].toLowerCase())
  ) {
    tokens.shift();
  }

  const cleaned: string[] = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (
      normalized === "this" ||
      normalized === "next" ||
      WEATHER_DATE_WORDS.has(normalized)
    ) {
      break;
    }
    cleaned.push(token);
  }

  return cleaned.length > 0 ? cleaned.join(" ") : null;
}

function normalizeWeatherDateLabel(rawDateLabel: string | null): string | null {
  if (!rawDateLabel) {
    return null;
  }

  const match = rawDateLabel.match(
    /\b(?:today|tonight|tomorrow|this weekend|next weekend|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );

  return match?.[0] ?? (rawDateLabel.trim() || null);
}

function normalizeWeatherLocationLabel(
  rawLocation: string | null,
): string | null {
  if (!rawLocation) {
    return null;
  }

  const tokens = rawLocation.trim().split(/\s+/).filter(Boolean);
  const filtered: string[] = [];

  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    if (
      lowerToken === "to" ||
      lowerToken === "in" ||
      lowerToken === "for" ||
      lowerToken === "at" ||
      lowerToken === "near" ||
      WEATHER_LOCATION_PREFIX_WORDS.has(lowerToken)
    ) {
      continue;
    }

    if (
      lowerToken === "this" ||
      lowerToken === "next" ||
      WEATHER_DATE_WORDS.has(lowerToken)
    ) {
      break;
    }

    filtered.push(token);
  }

  return filtered.length > 0 ? filtered.join(" ") : null;
}

export async function chat(
  client: OpenAI,
  history: Message[],
): Promise<ChatResult> {
  const availabilityRequestOptions = {
    timeout: getAvailabilityTimeoutMs(),
    maxRetries: 0,
  };
  const responseRequestOptions = {
    timeout: getResponseTimeoutMs(),
    maxRetries: 0,
  };
  return withEndpointFailover(async (activeClient, endpoint) => {
    const model = await resolveModel(
      activeClient,
      endpoint,
      availabilityRequestOptions,
    );
    const start = Date.now();

    const response = await activeClient.chat.completions.create(
      {
        model,
        messages: history,
        temperature: 0.7,
      },
      responseRequestOptions,
    );

    return {
      content: response.choices[0]?.message?.content ?? "(no response)",
      model: response.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      elapsedMs: Date.now() - start,
    };
  });
}

export async function streamChat(
  client: OpenAI,
  history: Message[],
  onDelta: StreamContentCallback,
): Promise<ChatResult> {
  const availabilityRequestOptions = {
    timeout: getAvailabilityTimeoutMs(),
    maxRetries: 0,
  };
  const responseRequestOptions = {
    timeout: getResponseTimeoutMs(),
    maxRetries: 0,
  };
  return withEndpointFailover(async (activeClient, endpoint) => {
    const model = await resolveModel(
      activeClient,
      endpoint,
      availabilityRequestOptions,
    );
    const start = Date.now();
    const stream = await activeClient.chat.completions.create(
      {
        model,
        messages: history,
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: true },
      },
      responseRequestOptions,
    );

    let content = "";
    let usage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } | null = null;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = chunk.usage;
      }

      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        content += delta;
        onDelta(delta);
      }
    }

    return {
      content: content || "(no response)",
      model,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      elapsedMs: Date.now() - start,
    };
  });
}

function parseWeatherIntent(content: string): WeatherIntent | null {
  const directJson = content.trim();
  const candidate =
    directJson.startsWith("{") && directJson.endsWith("}")
      ? directJson
      : (content.match(/\{[\s\S]*\}/)?.[0] ?? null);

  if (!candidate) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate) as Partial<WeatherIntent>;
    if (typeof parsed.needsWeather !== "boolean") {
      return null;
    }

    return {
      needsWeather: parsed.needsWeather,
      location:
        typeof parsed.location === "string" && parsed.location.trim()
          ? normalizeWeatherLocationLabel(parsed.location)
          : null,
      dateLabel:
        typeof parsed.dateLabel === "string" && parsed.dateLabel.trim()
          ? normalizeWeatherDateLabel(parsed.dateLabel)
          : null,
    };
  } catch {
    return null;
  }
}

export async function extractWeatherIntent(
  client: OpenAI,
  query: string,
): Promise<WeatherIntentResult> {
  const availabilityRequestOptions = {
    timeout: getAvailabilityTimeoutMs(),
    maxRetries: 0,
  };
  const responseRequestOptions = {
    timeout: getResponseTimeoutMs(),
    maxRetries: 0,
  };
  return withEndpointFailover(async (activeClient, endpoint) => {
    const model = await resolveModel(
      activeClient,
      endpoint,
      availabilityRequestOptions,
    );
    const start = Date.now();
    const response = await activeClient.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: buildWeatherExtractionPrompt() },
          { role: "user", content: query },
        ],
        temperature: 0,
        max_tokens: 120,
      },
      responseRequestOptions,
    );

    const content = response.choices[0]?.message?.content ?? "";
    return {
      intent: parseWeatherIntent(content),
      model: response.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      elapsedMs: Date.now() - start,
    };
  });
}
