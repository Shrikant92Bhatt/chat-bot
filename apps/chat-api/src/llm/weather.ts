export interface WeatherResult {
  location: string;
  current: {
    temperature: number;
    condition: string;
    humidity: number;
    windSpeed: number;
  };
  forecast: Array<{
    date: string;
    temperatureHigh: number;
    temperatureLow: number;
    condition: string;
    precipitationProbability: number;
  }>;
}

/**
 * WMO weather codes (used by Open-Meteo) mapped to a short human-readable
 * condition string. Not exhaustive of every WMO code - covers the ranges
 * Open-Meteo actually returns, falling back to "Unknown" for anything else
 * rather than guessing.
 */
const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function describeWeatherCode(code: number): string {
  return WMO_CONDITIONS[code] ?? 'Unknown';
}

/**
 * Real, structured weather data via Open-Meteo (free, no API key) - a
 * two-step lookup: geocode the place name to coordinates, then fetch
 * current + daily forecast for those coordinates. Returns a shape that
 * maps directly onto the WEATHER_CARD component (see orchestration/
 * ui-schema.ts) with no text-extraction step in between, unlike the
 * generic web_search tool.
 */
export async function getWeather(location: string): Promise<WeatherResult> {
  const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const geocodeRes = await fetch(geocodeUrl);
  if (!geocodeRes.ok) {
    throw new Error(`Geocoding request failed: ${geocodeRes.status}`);
  }
  const geocodeData = await geocodeRes.json();
  const place = geocodeData?.results?.[0];
  if (!place) {
    throw new Error(`Could not find a location matching "${location}".`);
  }

  const resolvedName = [place.name, place.admin1, place.country].filter(Boolean).join(', ');

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=5';
  const forecastRes = await fetch(forecastUrl);
  if (!forecastRes.ok) {
    throw new Error(`Forecast request failed: ${forecastRes.status}`);
  }
  const forecastData = await forecastRes.json();

  const current = forecastData?.current;
  if (!current) {
    throw new Error('Forecast response did not include current conditions.');
  }

  const daily = forecastData?.daily;
  const forecast: WeatherResult['forecast'] = [];
  if (daily?.time) {
    for (let i = 0; i < daily.time.length; i++) {
      forecast.push({
        date: daily.time[i],
        temperatureHigh: daily.temperature_2m_max[i],
        temperatureLow: daily.temperature_2m_min[i],
        condition: describeWeatherCode(daily.weather_code[i]),
        precipitationProbability: daily.precipitation_probability_max?.[i] ?? 0,
      });
    }
  }

  return {
    location: resolvedName,
    current: {
      temperature: current.temperature_2m,
      condition: describeWeatherCode(current.weather_code),
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
    },
    forecast,
  };
}
