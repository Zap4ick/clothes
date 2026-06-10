import type { ClothingItem } from "./sheets";
import { type WeatherForecast, formatWeatherForPrompt } from "./weather";

export interface WeatherIntent {
  needsWeather: boolean;
  location: string | null;
  dateLabel: string | null;
}

export function buildSystemPrompt(
  clothes: ClothingItem[],
  stylePreferences: string,
  weather: WeatherForecast | null,
): string {
  const now = new Date();
  const dateTime =
    now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }) +
    ", " +
    now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const wardrobe = clothes
    .map((c) => {
      const details = [c.type, c.color, c.fit, c.condition, c.notes]
        .filter(Boolean)
        .join(", ");
      return `- [${c.category}] ${c.name}${details ? ` (${details})` : ""}`;
    })
    .join("\n");

  const weatherSection = weather
    ? formatWeatherForPrompt(weather)
    : "## Weather\nUnavailable — ask the user if needed.";

  return `You are a personal fashion consultant. Your job is to suggest outfits from the user's wardrobe.

## Current Date & Time
${dateTime}

## User's Style Preferences
${stylePreferences.trim()}

${weatherSection}

## Available Wardrobe
${wardrobe}

Guidelines:
- Only suggest items from the wardrobe above.
- Be specific — name the exact items to wear together.
- Take weather into account proactively — mention if it's cold, rainy, etc.
- Keep suggestions concise and practical.
- Ask clarifying questions if context is vague (occasion, mood).
- Make suggestions based on good fashion principles
- Consider user's style preferences holistically, not just individual items.
- Consider user's past feedback to improve future suggestions.
- Consider user's pain points like height or grey hair.
- Remember the conversation history to give consistent advice.`;
}

export function buildWeatherExtractionPrompt(now = new Date()): string {
  const currentDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `You extract weather intent from a user message for an outfit assistant.

Current date: ${currentDate}

Return a single JSON object only with these keys:
- needsWeather: boolean
- location: string or null
- dateLabel: string or null

Rules:
- Set needsWeather to true when the user asks about weather, temperature, forecast, or what to wear for a day/time where weather matters.
- If the user names a city, town, region, country, or place, put the cleaned place name in location.
- If the user says they are going to, traveling to, visiting, or spending time in a place, treat that destination as the location.
- The location must contain only the place name. Do not include verbs, date words, or trip context like "go to", "this Saturday", or "for a date".
- Do not treat occasion/context words like "office", "work", "gym", "party", or "date" as location unless the user clearly names an actual geographic place.
- If the user mentions a day or date phrase like "Sunday", "tomorrow", "this weekend", or "next Friday", put that exact phrase in dateLabel.
- If a value is not present, use null.
- Do not invent a location or date.
- Do not add any extra text outside the JSON object.

Examples:
User: "what should I wear on Sunday in Gdansk?"
Output: {"needsWeather":true,"location":"Gdansk","dateLabel":"Sunday"}

User: "i plan to go to gdansk this saturday for a date"
Output: {"needsWeather":true,"location":"Gdansk","dateLabel":"this saturday"}

User: "do I need a jacket tomorrow?"
Output: {"needsWeather":true,"location":null,"dateLabel":"tomorrow"}

User: "thanks"
Output: {"needsWeather":false,"location":null,"dateLabel":null}`;
}
