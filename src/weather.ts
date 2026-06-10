export interface WeatherForecast {
  location: string;
  current: {
    tempC: number;
    feelsLikeC: number;
    description: string;
    humidity: number;
  };
  days: Array<{
    date: string;
    maxC: number;
    minC: number;
    description: string;
  }>;
}

interface GeoLocation {
  location: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

interface ResolvedLocation extends GeoLocation {}

function describeWeatherCode(code: number): string {
  switch (code) {
    case 0:
      return "Clear sky";
    case 1:
      return "Mainly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
    case 48:
      return "Fog";
    case 51:
    case 53:
    case 55:
      return "Drizzle";
    case 56:
    case 57:
      return "Freezing drizzle";
    case 61:
    case 63:
    case 65:
      return "Rain";
    case 66:
    case 67:
      return "Freezing rain";
    case 71:
    case 73:
    case 75:
      return "Snow";
    case 77:
      return "Snow grains";
    case 80:
    case 81:
    case 82:
      return "Rain showers";
    case 85:
    case 86:
      return "Snow showers";
    case 95:
      return "Thunderstorm";
    case 96:
    case 99:
      return "Thunderstorm with hail";
    default:
      return "Unknown conditions";
  }
}

async function fetchGeoLocation(): Promise<GeoLocation | null> {
  try {
    const res = await fetch("https://ipinfo.io/json");
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    const [latitudeText, longitudeText] = String(data.loc ?? "").split(",");
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const location = [data.city, data.region, data.country]
      .filter(Boolean)
      .join(", ");

    return {
      location: location || "Your location",
      latitude,
      longitude,
      timezone: data.timezone ?? "auto",
    };
  } catch {
    return null;
  }
}

async function geocodeLocation(
  locationName: string,
): Promise<ResolvedLocation | null> {
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", locationName);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    const candidate = data.results?.[0];
    if (!candidate) return null;

    const location = [candidate.name, candidate.admin1, candidate.country]
      .filter(Boolean)
      .join(", ");

    return {
      location,
      latitude: Number(candidate.latitude),
      longitude: Number(candidate.longitude),
      timezone: candidate.timezone ?? "auto",
    };
  } catch {
    return null;
  }
}

async function resolveLocation(
  locationName?: string,
): Promise<GeoLocation | null> {
  if (locationName) {
    return geocodeLocation(locationName);
  }

  return fetchGeoLocation();
}

export async function fetchWeather(
  locationName?: string,
): Promise<WeatherForecast | null> {
  try {
    const geo = await resolveLocation(locationName);
    if (!geo) return null;

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", geo.latitude.toString());
    url.searchParams.set("longitude", geo.longitude.toString());
    url.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,weather_code,relative_humidity_2m",
    );
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,weather_code",
    );
    url.searchParams.set("forecast_days", "7");
    url.searchParams.set("timezone", geo.timezone);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;

    const parseDay = (index: number) => ({
      date: String(data.daily.time?.[index] ?? ""),
      maxC: Number(data.daily.temperature_2m_max?.[index]),
      minC: Number(data.daily.temperature_2m_min?.[index]),
      description: describeWeatherCode(
        Number(data.daily.weather_code?.[index]),
      ),
    });

    return {
      location: geo.location,
      current: {
        tempC: Number(data.current.temperature_2m),
        feelsLikeC: Number(data.current.apparent_temperature),
        description: describeWeatherCode(Number(data.current.weather_code)),
        humidity: Number(data.current.relative_humidity_2m),
      },
      days: Array.isArray(data.daily?.time)
        ? data.daily.time.map((_: string, index: number) => parseDay(index))
        : [],
    };
  } catch {
    return null;
  }
}

export function formatWeatherForPrompt(w: WeatherForecast): string {
  const fmt = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });

  const forecastLines = w.days.length
    ? w.days
        .map(
          (day) =>
            `- ${fmt(day.date)}: ${day.minC}–${day.maxC}°C, ${day.description}`,
        )
        .join("\n")
    : "- No forecast days available.";

  return `## Weather Forecast (${w.location})
- Right now: ${w.current.tempC}°C (feels like ${w.current.feelsLikeC}°C), ${w.current.description}, humidity ${w.current.humidity}%
- Available forecast days:
${forecastLines}

When the user asks about a specific day, use the matching forecast above if it exists. If the requested day is not listed, say the forecast is unavailable for that date.`;
}
