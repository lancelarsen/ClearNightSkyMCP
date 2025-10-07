import https from "node:https";

const USER_AGENT = "ClearNightSkyMCP/1.0 (ops@clearnightsky.example)";
const url = "https://api.weather.gov/gridpoints/LWX/97,71/forecast/hourly";

https.get(url, { headers: { "User-Agent": USER_AGENT } }, (res) => {
  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      const periods = json.properties?.periods ?? [];
      const selection = periods.slice(0, 6);
      selection.forEach((period) => {
        const precip = period.probabilityOfPrecipitation?.value;
        const precipText = typeof precip === "number" ? `${precip}%` : "?";
        console.log(
          `${period.startTime} | Temp: ${period.temperature}\u00B0${period.temperatureUnit} | Wind: ${period.windSpeed} ${period.windDirection ?? ""}`.trim() +
            ` | Precip: ${precipText} | ${period.shortForecast || "No summary"}`,
        );
      });
    } catch (error) {
      console.error("Failed to parse forecast", error);
      process.exitCode = 1;
    }
  });
}).on("error", (error) => {
  console.error("Request failed", error);
  process.exitCode = 1;
});
