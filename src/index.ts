import * as dotenv from "dotenv";
import * as fs from "fs";
import type OpenAI from "openai";
import * as path from "path";
import * as readline from "readline";
import {
  createClient,
  extractWeatherIntent,
  preflightAI,
  streamChat,
} from "./ai";
import { fetchClothesFromFiles } from "./local-reader";
import { buildSystemPrompt } from "./prompts";
import { fetchClothes } from "./sheets";
import { fetchWeather, type WeatherForecast } from "./weather";

dotenv.config();

type Message = OpenAI.Chat.ChatCompletionMessageParam;

async function loadStylePreferences(): Promise<string> {
  const prefsPath = path.resolve("style-preferences.md");
  if (!fs.existsSync(prefsPath)) {
    return "No specific style preferences provided.";
  }
  return fs.readFileSync(prefsPath, "utf-8");
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner(label: string): () => void {
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(
      `\r${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${label}`,
    );
  }, 80);
  return () => {
    clearInterval(interval);
    process.stdout.write("\r\x1b[2K"); // clear the spinner line
  };
}

function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

function logInfo(text: string): void {
  console.log(dim(text));
}

function logError(text: string): void {
  console.error(dim(text));
}

function saveLatestSuggestion(content: string): string {
  const suggestionsPath = path.resolve("output", "suggestions.md");
  fs.mkdirSync(path.dirname(suggestionsPath), { recursive: true });
  fs.writeFileSync(suggestionsPath, `${content}\n`, "utf-8");
  return suggestionsPath;
}

function formatMillis(ms: number): string {
  return `${ms}ms`;
}

function formatWeatherDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function shouldRefreshWeather(query: string): boolean {
  return /\b(weather|forecast|temperature|temp|rain|rainy|snow|snowy|sunny|wind|windy|humid|humidity|umbrella|coat|jacket|today|tonight|tomorrow|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday|next week|this week)\b/i.test(
    query,
  );
}

function extractWeatherDateLabel(query: string): string | null {
  const match = query.match(
    /\b(?:today|tonight|tomorrow|this weekend|next weekend|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );

  return match?.[0] ?? null;
}

const WEATHER_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
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
  "date",
  "day",
  "days",
  "forecast",
  "location",
  "place",
  "city",
  "weather",
  "today",
  "tonight",
  "tomorrow",
  "week",
  "weekend",
  "next",
  "this",
  "current",
  "in",
  "for",
  "at",
  "near",
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

const NON_GEOGRAPHIC_LOCATION_WORDS = new Set([
  "office",
  "work",
  "workplace",
  "job",
  "school",
  "university",
  "campus",
  "home",
  "house",
  "indoors",
  "indoor",
  "outdoors",
  "outdoor",
  "inside",
  "outside",
]);

function normalizeWeatherLocationCandidate(
  rawLocation: string | null,
): string | null {
  if (!rawLocation) {
    return null;
  }

  const tokens = rawLocation.trim().split(/\s+/).filter(Boolean);

  while (tokens.length > 0 && WEATHER_STOP_WORDS.has(tokens[0].toLowerCase())) {
    tokens.shift();
  }

  const cleaned: string[] = [];
  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    if (
      WEATHER_DATE_WORDS.has(lowerToken) ||
      lowerToken === "this" ||
      lowerToken === "next"
    ) {
      break;
    }
    cleaned.push(token);
  }

  if (cleaned.length === 0) {
    return null;
  }

  const normalized = cleaned.join(" ");
  if (NON_GEOGRAPHIC_LOCATION_WORDS.has(normalized.toLowerCase())) {
    return null;
  }

  return normalized;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLocationExplicitlyMentioned(
  query: string,
  location: string | null,
): boolean {
  if (!location) {
    return false;
  }

  const pattern = new RegExp(`\\b${escapeForRegex(location)}\\b`, "i");
  return pattern.test(query);
}

function extractWeatherLocation(query: string): string | null {
  const match = query.match(
    /\b(?:in|for|at|near|to|go to|travel to|visit)\s+([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+)*)(?=\s+\b(?:today|tonight|tomorrow|this|next|weather|forecast|temperature|temp|rain|rainy|snow|snowy|sunny|wind|windy|humid|humidity|umbrella|coat|jacket|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|[?.!,]|$)/i,
  );

  return normalizeWeatherLocationCandidate(match?.[1] ?? null);
}

function getAIEndpoint(): string {
  if (process.env.EXTERNAL_AI_BASE_URL) {
    return process.env.EXTERNAL_AI_BASE_URL;
  }
  return process.env.LOCAL_AI_BASE_URL ?? "http://localhost:1234/v1";
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const lines = [`${err.name}: ${err.message}`];
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      lines.push(
        `Cause: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
      );
    }
    if (err.stack) {
      lines.push(err.stack);
    }
    return lines.join("\n");
  }
  return String(err);
}

function logAIFailure(prefix: string, err: unknown): void {
  logError(
    `${prefix}\n  Endpoint: ${getAIEndpoint()}\n  ${formatError(err).replace(/\n/g, "\n  ")}`,
  );
}

async function fetchWeatherWithTiming(): Promise<{
  weather: WeatherForecast | null;
  elapsedMs: number;
}>;
async function fetchWeatherWithTiming(locationName: string): Promise<{
  weather: WeatherForecast | null;
  elapsedMs: number;
}>;
async function fetchWeatherWithTiming(locationName?: string): Promise<{
  weather: WeatherForecast | null;
  elapsedMs: number;
}> {
  const start = Date.now();
  const weather = await fetchWeather(locationName);
  return { weather, elapsedMs: Date.now() - start };
}

function logWeatherResult(
  prefix: string,
  requestedLocation: string | null,
  requestedDate: string | null,
  weather: WeatherForecast | null,
  elapsedMs: number,
): void {
  const cleanedLocation = normalizeWeatherLocationCandidate(requestedLocation);
  const requestLabel = [requestedDate, cleanedLocation]
    .filter(Boolean)
    .join(" in ");
  const locationLabel = requestLabel ? ` for ${requestLabel}` : "";
  if (weather) {
    logInfo(
      `${prefix} ✓ ${weather.current.tempC}°C, ${weather.current.description} in ${weather.location}${locationLabel} ${dim(`(${formatMillis(elapsedMs)})`)}`,
    );
  } else {
    logInfo(
      `${prefix} ⚠️  Could not fetch weather${locationLabel}. ${dim(`(${formatMillis(elapsedMs)})`)}`,
    );
  }
}

function logWeatherIntentStats(result: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  elapsedMs: number;
}): void {
  console.log(
    dim(
      `  ↳ weather intent · ${formatMillis(result.elapsedMs)} · ${result.totalTokens} tokens (${result.promptTokens} in / ${result.completionTokens} out) · ${result.model}`,
    ),
  );
}

function weatherCoversRequestedDate(
  weather: WeatherForecast | null,
  requestedDate: string | null,
): boolean {
  if (!weather) {
    return false;
  }

  if (!requestedDate) {
    return true;
  }

  const normalizedRequestedDate = requestedDate.toLowerCase();

  if (normalizedRequestedDate === "today") {
    return weather.days.length > 0;
  }

  if (normalizedRequestedDate === "tomorrow") {
    return weather.days.length > 1;
  }

  const requestedWeekday = normalizedRequestedDate.slice(0, 3);
  return weather.days.some((day) => {
    const dayWeekday = new Date(`${day.date}T00:00:00`)
      .toLocaleDateString("en-US", { weekday: "long" })
      .toLowerCase();
    return dayWeekday.slice(0, 3) === requestedWeekday;
  });
}

function normalizeWeatherIntent(
  query: string,
  aiIntent: {
    needsWeather: boolean;
    location: string | null;
    dateLabel: string | null;
  } | null,
  fallbackLocation: string | null,
  fallbackDate: string | null,
): {
  needsWeather: boolean;
  location: string | null;
  dateLabel: string | null;
} | null {
  const explicitFallbackLocation = isLocationExplicitlyMentioned(
    query,
    fallbackLocation,
  )
    ? normalizeWeatherLocationCandidate(fallbackLocation)
    : null;

  if (aiIntent?.needsWeather) {
    const aiCandidate = normalizeWeatherLocationCandidate(
      aiIntent.location ?? fallbackLocation,
    );
    const explicitLocation = isLocationExplicitlyMentioned(query, aiCandidate)
      ? aiCandidate
      : explicitFallbackLocation;

    return {
      needsWeather: true,
      location: explicitLocation,
      dateLabel: aiIntent.dateLabel ?? fallbackDate,
    };
  }

  if (fallbackLocation || fallbackDate) {
    return {
      needsWeather: true,
      location: explicitFallbackLocation,
      dateLabel: fallbackDate,
    };
  }

  return null;
}

async function main() {
  logInfo("👗 AI Clothing Consultant");
  logInfo("─────────────────────────");

  const useLocal = process.env.WARDROBE_SOURCE === "local";
  process.stdout.write(
    dim(
      `Fetching wardrobe from ${useLocal ? "local files" : "Google Sheets"}... `,
    ),
  );
  const wardrobeStart = Date.now();
  const clothes = useLocal ? fetchClothesFromFiles() : await fetchClothes();
  const wardrobeElapsed = Date.now() - wardrobeStart;
  if (clothes.length === 0) {
    logInfo(
      `⚠️  Wardrobe is empty. Add items to your Google Sheet first. ${dim(`(${formatMillis(wardrobeElapsed)})`)}`,
    );
  } else {
    logInfo(
      `✓ Loaded ${clothes.length} item(s) from your wardrobe ${dim(`(${formatMillis(wardrobeElapsed)})`)}`,
    );
  }

  process.stdout.write(dim("Fetching weather forecast... "));
  const initialWeatherResult = await fetchWeatherWithTiming();
  logWeatherResult(
    "",
    null,
    null,
    initialWeatherResult.weather,
    initialWeatherResult.elapsedMs,
  );

  const stylePreferences = await loadStylePreferences();
  let weather = initialWeatherResult.weather;
  let weatherSourceLocation: string | null = null;
  let systemPrompt = buildSystemPrompt(clothes, stylePreferences, weather);
  const client = createClient();
  let aiModel: string;
  process.stdout.write(dim("Checking AI connection... "));
  const aiStart = Date.now();
  try {
    aiModel = await preflightAI(client);
  } catch (err: unknown) {
    const aiElapsed = Date.now() - aiStart;
    logInfo(`(${formatMillis(aiElapsed)})`);
    logAIFailure("AI preflight failed.", err);
    throw err;
  }
  const aiElapsed = Date.now() - aiStart;
  logInfo(`✓ ${aiModel} reachable ${dim(`(${formatMillis(aiElapsed)})`)}`);

  const history: Message[] = [{ role: "system", content: systemPrompt }];

  async function refreshWeatherIfNeeded(query: string): Promise<boolean> {
    const fallbackLocation = extractWeatherLocation(query);
    const fallbackDate = extractWeatherDateLabel(query);
    const shouldTryWeather =
      shouldRefreshWeather(query) ||
      fallbackLocation !== null ||
      fallbackDate !== null;
    if (!shouldTryWeather) {
      return false;
    }

    const currentLocation = weatherSourceLocation;
    const canReuseCachedWeatherDeterministically =
      (fallbackLocation !== null || fallbackDate !== null) &&
      currentLocation === fallbackLocation &&
      weatherCoversRequestedDate(weather, fallbackDate);

    if (canReuseCachedWeatherDeterministically) {
      logInfo(
        `Using cached weather forecast ${dim(`(${weather?.location ?? "unknown location"})`)}`,
      );
      return true;
    }

    const weatherIntentResult = await extractWeatherIntent(client, query).catch(
      () => null,
    );
    if (weatherIntentResult) {
      logWeatherIntentStats(weatherIntentResult);
    }

    const weatherIntent = normalizeWeatherIntent(
      query,
      weatherIntentResult?.intent ?? null,
      fallbackLocation,
      fallbackDate,
    );
    if (!weatherIntent) {
      return weatherIntentResult !== null;
    }

    const requestedLocation = weatherIntent.location;
    const canReuseCachedWeather =
      currentLocation === requestedLocation &&
      weatherCoversRequestedDate(weather, weatherIntent.dateLabel);

    if (canReuseCachedWeather) {
      logInfo(
        `Using cached weather forecast ${dim(`(${weather?.location ?? "unknown location"})`)}`,
      );
      return true;
    }

    const requestLabel = [weatherIntent.dateLabel, weatherIntent.location]
      .filter(Boolean)
      .join(" in ");
    const locationLabel = requestLabel ? ` for ${requestLabel}` : "";
    process.stdout.write(
      dim(`Refreshing weather forecast${locationLabel}... `),
    );
    const result = weatherIntent.location
      ? await fetchWeatherWithTiming(weatherIntent.location)
      : await fetchWeatherWithTiming();
    logWeatherResult(
      "",
      weatherIntent.location,
      weatherIntent.dateLabel,
      result.weather,
      result.elapsedMs,
    );

    if (result.weather) {
      weather = result.weather;
      weatherSourceLocation = weatherIntent.location;
      systemPrompt = buildSystemPrompt(clothes, stylePreferences, weather);
      history[0] = { role: "system", content: systemPrompt };
    }

    return true;
  }

  async function runAssistantTurn(input: string): Promise<void> {
    const wroteOperationalLogs = await refreshWeatherIfNeeded(input);

    if (wroteOperationalLogs) {
      console.log();
    }

    history.push({ role: "user", content: input });

    const stop = startSpinner("Thinking...");
    try {
      let started = false;
      let streamedAnyContent = false;
      const result = await streamChat(client, history, (delta) => {
        if (delta) {
          if (!started) {
            started = true;
            stop();
            process.stdout.write("Assistant: ");
          }
          streamedAnyContent = true;
          process.stdout.write(delta);
        }
      });
      stop();
      if (!streamedAnyContent) {
        process.stdout.write("Assistant: ");
        process.stdout.write(result.content);
      }
      console.log();
      console.log();
      console.log(
        `\x1b[2m  ⏱ ${(result.elapsedMs / 1000).toFixed(1)}s · ${result.totalTokens} tokens (${result.promptTokens} in / ${result.completionTokens} out) · ${result.model}\x1b[0m`,
      );
      console.log();
      const savedSuggestionPath = saveLatestSuggestion(result.content);
      logInfo(`Saved latest assistant suggestion to ${savedSuggestionPath}`);
      history.push({ role: "assistant", content: result.content });
    } catch (err: unknown) {
      stop();
      logAIFailure("❌ Error while talking to the AI.", err);
      console.error();
    }
  }

  const cliPrompt = process.argv.slice(2).join(" ").trim();
  if (cliPrompt) {
    await runAssistantTurn(cliPrompt);
    return;
  }

  logInfo(
    `\nReady! AI model ${aiModel} is reachable. Ask me what to wear (type 'exit' or Ctrl+C to quit).\n`,
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        ask();
        return;
      }

      if (trimmed.toLowerCase() === "exit") {
        logInfo("Goodbye! 👋");
        rl.close();
        return;
      }

      await runAssistantTurn(trimmed);

      ask();
    });
  };

  rl.on("close", () => process.exit(0));
  ask();
}

main().catch((err) => {
  logAIFailure("Fatal error.", err);
  process.exit(1);
});
