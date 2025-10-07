import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "ClearNightSkyMCP/1.0 (ops@clearnightsky.example)";
const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "application/geo+json",
};

interface TimedNumberValue {
  validTime: string;
  value: number | null;
}

interface ForecastPeriod {
  name?: string;
  startTime?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
  detailedForecast?: string;
}

interface ForecastResponse {
  properties?: {
    periods?: ForecastPeriod[];
  };
}

interface RelativeLocationProperties {
  city?: string;
  state?: string;
  distance?: {
    value?: number;
    unitCode?: string;
  };
}

interface PointsResponse {
  properties: {
    cwa?: string;
    gridId?: string;
    gridX?: number;
    gridY?: number;
    forecast?: string;
    forecastHourly?: string;
    forecastGridData?: string;
    forecastZone?: string;
    county?: string;
    timeZone?: string;
    relativeLocation?: {
      properties?: RelativeLocationProperties;
    };
  };
}

interface GridpointSeries {
  uom?: string;
  values: TimedNumberValue[];
}

interface GridpointResponse {
  properties: {
    skyCover?: GridpointSeries;
    probabilityOfPrecipitation?: GridpointSeries;
    visibility?: GridpointSeries;
  };
}

const server = new Server({
  name: "clear-night-sky",
  version: "0.1.0",
});

async function fetchJson<T>(url: string): Promise<T> {
  try {
    const response = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} when requesting ${url}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Failed to fetch", url, error);
    throw error;
  }
}

async function getPointMetadata(latitude: number, longitude: number): Promise<PointsResponse> {
  const url = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  return fetchJson<PointsResponse>(url);
}

function formatCoordinateSummary(points: PointsResponse, latitude: number, longitude: number): string {
  const props = points.properties;
  const location = props.relativeLocation?.properties;
  const city = location?.city;
  const state = location?.state;
  const gridId = props.gridId ?? "?";
  const gridX = props.gridX ?? "?";
  const gridY = props.gridY ?? "?";
  const tz = props.timeZone ?? "Unknown";
  const distance = location?.distance?.value;
  const distanceUnit = location?.distance?.unitCode;
  const distanceText = typeof distance === "number" && distanceUnit === "wmoUnit:m"
    ? `${(distance / 1000).toFixed(1)} km from point`
    : undefined;

  const lines: string[] = [];
  lines.push(`Resolved ${latitude.toFixed(4)}, ${longitude.toFixed(4)} to grid ${gridId} (${gridX}, ${gridY}) in ${props.cwa ?? ""}`.trim());
  if (city || state) {
    lines.push(`Nearest location: ${[city, state].filter(Boolean).join(", ")}`);
  }
  if (distanceText) {
    lines.push(distanceText);
  }
  if (props.county) {
    lines.push(`County: ${props.county}`);
  }
  if (props.forecastZone) {
    lines.push(`Forecast zone: ${props.forecastZone}`);
  }
  lines.push(`Time zone: ${tz}`);
  if (props.forecast) {
    lines.push(`7-day forecast: ${props.forecast}`);
  }
  if (props.forecastHourly) {
    lines.push(`Hourly forecast: ${props.forecastHourly}`);
  }
  if (props.forecastGridData) {
    lines.push(`Grid data: ${props.forecastGridData}`);
  }
  return lines.join("\n");
}

function formatForecast(periods: ForecastPeriod[], limit: number, heading: string): string {
  const trimmed = periods.slice(0, limit);
  if (!trimmed.length) {
    return `${heading}: No forecast periods available.`;
  }
  const items = trimmed.map((period) => {
    const name = period.name ?? "Unknown";
    const tempUnit = period.temperatureUnit ?? "";
    const temperature = typeof period.temperature === "number" ? `${period.temperature}°${tempUnit}` : "Temperature unavailable";
    const wind = [period.windSpeed, period.windDirection].filter(Boolean).join(" ") || "Wind data unavailable";
    const summary = period.detailedForecast ?? period.shortForecast ?? "No forecast description provided.";
    const start = period.startTime ? new Date(period.startTime).toISOString() : undefined;
    return [
      `${name}${start ? ` (${start})` : ""}`,
      `Temperature: ${temperature}`,
      `Wind: ${wind}`,
      `Forecast: ${summary}`,
    ].join("\n");
  });
  return `${heading}:\n\n${items.join("\n\n---\n\n")}`;
}

function parseISODurationToMs(duration: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(duration);
  if (!match) {
    return 0;
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

function parseValidTime(validTime: string): { start: Date; end: Date } {
  const [startIso, duration] = validTime.split("/");
  const start = new Date(startIso);
  const durationMs = duration ? parseISODurationToMs(duration) : 0;
  const fallbackMs = 60 * 60 * 1000;
  const totalMs = durationMs > 0 ? durationMs : fallbackMs;
  return {
    start,
    end: new Date(start.getTime() + totalMs),
  };
}

function formatTimeRange(validTime: string): string {
  const { start, end } = parseValidTime(validTime);
  const startLabel = start.toISOString();
  const endLabel = end.toISOString();
  return `${startLabel} → ${endLabel}`;
}

function formatVisibility(value: number | null | undefined, uom?: string): string {
  if (value == null) {
    return "unknown";
  }
  if (uom === "wmoUnit:m") {
    const miles = value / 1609.344;
    if (miles >= 10) {
      return `${miles.toFixed(0)} mi`;
    }
    if (miles >= 1) {
      return `${miles.toFixed(1)} mi`;
    }
    return `${(value / 1000).toFixed(1)} km`;
  }
  return `${value}`;
}

type ToolExecutor = (args: Record<string, unknown>) => Promise<CallToolResult>;

function toTextResult(text: string, isError = false): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError,
  };
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "arguments";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function parseArguments<T>(schema: z.ZodType<T>, rawArgs: Record<string, unknown>): T {
  const result = schema.safeParse(rawArgs);
  if (!result.success) {
    throw new Error(formatZodIssues(result.error));
  }
  return result.data;
}

const coordinateArgumentParser = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

const dailyForecastArgumentParser = coordinateArgumentParser.extend({
  periods: z.coerce.number().min(1).max(14).default(6),
});

const hourlyForecastArgumentParser = coordinateArgumentParser.extend({
  hours: z.coerce.number().min(1).max(24).default(6),
});

const clearSkyArgumentParser = coordinateArgumentParser.extend({
  horizonHours: z.coerce.number().min(3).max(24).default(12),
});

function asToolInputSchema(schema: Record<string, unknown>): Tool["inputSchema"] {
  return schema as Tool["inputSchema"];
}

const coordinateProperties = {
  latitude: {
    type: "number",
    minimum: -90,
    maximum: 90,
    description: "Latitude of the observing location (decimal degrees).",
  },
  longitude: {
    type: "number",
    minimum: -180,
    maximum: 180,
    description: "Longitude of the observing location (decimal degrees).",
  },
} as const;

const resolvePointInputSchema = asToolInputSchema({
  type: "object",
  properties: coordinateProperties,
  required: ["latitude", "longitude"],
});

const dailyForecastInputSchema = asToolInputSchema({
  type: "object",
  properties: {
    ...coordinateProperties,
    periods: {
      type: "integer",
      minimum: 1,
      maximum: 14,
      default: 6,
      description: "How many forecast periods to return (each period ~12 hours).",
    },
  },
  required: ["latitude", "longitude"],
});

const hourlyForecastInputSchema = asToolInputSchema({
  type: "object",
  properties: {
    ...coordinateProperties,
    hours: {
      type: "integer",
      minimum: 1,
      maximum: 24,
      default: 6,
      description: "How many hourly entries to include (short-term outlook).",
    },
  },
  required: ["latitude", "longitude"],
});

const clearSkyInputSchema = asToolInputSchema({
  type: "object",
  properties: {
    ...coordinateProperties,
    horizonHours: {
      type: "integer",
      minimum: 3,
      maximum: 24,
      default: 12,
      description: "Number of hours ahead to analyze for observing windows.",
    },
  },
  required: ["latitude", "longitude"],
});

const toolDefinitions: Tool[] = [
  {
    name: "resolve_point_metadata",
    description: "Resolve NWS metadata for a coordinate pair, including grid and time zone details.",
    inputSchema: resolvePointInputSchema,
  },
  {
    name: "get_daily_forecast",
    description: "Fetch the multi-period NWS forecast for the provided coordinates.",
    inputSchema: dailyForecastInputSchema,
  },
  {
    name: "get_hourly_forecast",
    description: "Fetch hourly NWS forecast periods for near-term planning.",
    inputSchema: hourlyForecastInputSchema,
  },
  {
    name: "get_clear_sky_window",
    description: "Analyze sky cover, precipitation, and visibility to highlight the best observing window.",
    inputSchema: clearSkyInputSchema,
  },
];

const handleResolvePointMetadata: ToolExecutor = async (rawArgs) => {
  try {
    const { latitude, longitude } = parseArguments(coordinateArgumentParser, rawArgs);
    const points = await getPointMetadata(latitude, longitude);
    return toTextResult(formatCoordinateSummary(points, latitude, longitude));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toTextResult(`Unable to resolve metadata. ${message}`, true);
  }
};

const handleDailyForecast: ToolExecutor = async (rawArgs) => {
  try {
    const parsed = parseArguments(dailyForecastArgumentParser, rawArgs);
    const { latitude, longitude } = parsed;
    const periods = parsed.periods ?? 6;
    const points = await getPointMetadata(latitude, longitude);
    const forecastUrl = points.properties.forecast;
    if (!forecastUrl) {
      throw new Error("Forecast URL not available for this coordinate (outside NWS coverage).");
    }
    const forecast = await fetchJson<ForecastResponse>(forecastUrl);
    const periodsData = forecast.properties?.periods ?? [];
    return toTextResult(
      formatForecast(periodsData, periods, `NWS forecast for ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toTextResult(`Unable to fetch daily forecast. ${message}`, true);
  }
};

const handleHourlyForecast: ToolExecutor = async (rawArgs) => {
  try {
    const parsed = parseArguments(hourlyForecastArgumentParser, rawArgs);
    const { latitude, longitude } = parsed;
    const hours = parsed.hours ?? 6;
    const points = await getPointMetadata(latitude, longitude);
    const hourlyUrl = points.properties.forecastHourly;
    if (!hourlyUrl) {
      throw new Error("Hourly forecast URL not available for this coordinate.");
    }
    const forecast = await fetchJson<ForecastResponse>(hourlyUrl);
    const periodsData = forecast.properties?.periods ?? [];
    return toTextResult(
      formatForecast(periodsData, hours, `Hourly forecast for ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toTextResult(`Unable to fetch hourly forecast. ${message}`, true);
  }
};

const handleClearSkyWindow: ToolExecutor = async (rawArgs) => {
  try {
    const parsed = parseArguments(clearSkyArgumentParser, rawArgs);
    const { latitude, longitude } = parsed;
    const horizonHours = parsed.horizonHours ?? 12;
    const points = await getPointMetadata(latitude, longitude);
    const gridUrl = points.properties.forecastGridData;
    if (!gridUrl) {
      throw new Error("Grid data URL not available for this coordinate.");
    }
    const gridData = await fetchJson<GridpointResponse>(gridUrl);
    const skySeries = gridData.properties.skyCover?.values ?? [];
    if (!skySeries.length) {
      throw new Error("Sky cover data not available.");
    }
    const precipSeries = gridData.properties.probabilityOfPrecipitation?.values ?? [];
    const visibilitySeries = gridData.properties.visibility?.values ?? [];
    const visibilityUnit = gridData.properties.visibility?.uom;

    const windowLength = Math.min(horizonHours, skySeries.length);
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    const rows: string[] = [];

    for (let i = 0; i < windowLength; i += 1) {
      const sky = skySeries[i];
      const precip = precipSeries[i];
      const vis = visibilitySeries[i];
      const skyValue = typeof sky?.value === "number" ? sky.value : 100;
      const precipValue = typeof precip?.value === "number" ? precip.value : 100;
      const score = skyValue + precipValue * 0.5;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      rows.push(
        [
          formatTimeRange(sky.validTime),
          `Sky cover: ${sky.value ?? "?"}%`,
          `Precip chance: ${precip?.value ?? "?"}%`,
          `Visibility: ${formatVisibility(vis?.value ?? null, visibilityUnit)}`,
        ].join(" | "),
      );
    }

    const highlight = bestIndex >= 0 ? rows[bestIndex] : "No clear window detected.";
    const insight = bestIndex >= 0
      ? `Promising observing window: ${highlight}`
      : "No promising window identified within the requested horizon.";

    return toTextResult(
      [
        `Clear sky analysis for ${latitude.toFixed(4)}, ${longitude.toFixed(4)} (next ${windowLength} hours):`,
        "",
        insight,
        "",
        "Hourly breakdown:",
        rows.join("\n"),
      ].join("\n"),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toTextResult(`Unable to analyze clear sky window. ${message}`, true);
  }
};

const toolHandlers: Record<string, ToolExecutor> = {
  resolve_point_metadata: handleResolvePointMetadata,
  get_daily_forecast: handleDailyForecast,
  get_hourly_forecast: handleHourlyForecast,
  get_clear_sky_window: handleClearSkyWindow,
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
  const handler = toolHandlers[toolName];
  if (!handler) {
    return toTextResult(`Unknown tool: ${toolName}`, true);
  }
  try {
    return await handler(rawArgs);
  } catch (error) {
    console.error(`Tool ${toolName} failed`, error);
    const message = error instanceof Error ? error.message : String(error);
    return toTextResult(`Tool '${toolName}' failed: ${message}`, true);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Clear Night Sky MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in Clear Night Sky MCP server", error);
  process.exit(1);
});
