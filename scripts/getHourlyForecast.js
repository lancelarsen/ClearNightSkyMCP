import https from "node:https";

const USER_AGENT = "ClearNightSkyMCP/1.0 (ops@clearnightsky.example)";

const [latArg, lonArg] = process.argv.slice(2);

if (!latArg || !lonArg) {
  console.error("Usage: node scripts/getHourlyForecast.js <latitude> <longitude>");
  process.exit(1);
}

const latitude = Number(latArg);
const longitude = Number(lonArg);

if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
  console.error("Latitude and longitude must be numeric.");
  process.exit(1);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": USER_AGENT } }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Request failed with status ${res.statusCode}: ${url}`));
          res.resume();
          return;
        }

        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`Failed to parse JSON for ${url}: ${error.message}`));
          }
        });
      })
      .on("error", (error) => {
        reject(error);
      });
  });
}

(async () => {
  try {
    const point = await fetchJson(`https://api.weather.gov/points/${latitude},${longitude}`);
    const hourlyUrl = point.properties?.forecastHourly;

    if (typeof hourlyUrl !== "string") {
      throw new Error("Hourly forecast URL missing from point metadata.");
    }

    const forecast = await fetchJson(hourlyUrl);
    const periods = forecast.properties?.periods ?? [];

    periods.slice(0, 6).forEach((period) => {
      const precip = period.probabilityOfPrecipitation?.value;
      const precipText = typeof precip === "number" ? `${precip}%` : "?";
      console.log(
        `${period.startTime} | Temp: ${period.temperature}\u00B0${period.temperatureUnit} | Wind: ${period.windSpeed} ${period.windDirection ?? ""}`.trim() +
          ` | Precip: ${precipText} | ${period.shortForecast || "No summary"}`,
      );
    });
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
})();
