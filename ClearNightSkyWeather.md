# Clear Night Sky Weather API Endpoints

> **Note:** Every request must include a descriptive `User-Agent` header (for example, `User-Agent: ClearNightSkyApp (contact@example.com)`). The API defaults to `GET` responses in GeoJSON; set the `Accept` header if you need a different format.

## Endpoint Summary

| Endpoint | HTTP Method | Path | Parameters (Type — Required?) | How to Call |
| - | - | - | - | - |
| Resolve point metadata | GET | `https://api.weather.gov/points/{lat},{lon}` | `lat` (decimal — required)  •  `lon` (decimal — required) | `curl -H "User-Agent: ClearNightSkyApp (contact@example.com)" https://api.weather.gov/points/38.8894,-77.0352` |
| Seven-day forecast | GET | `https://api.weather.gov/points/{lat},{lon}/forecast` | `lat` (decimal — required)  •  `lon` (decimal — required) | `curl -H "User-Agent: ClearNightSkyApp (contact@example.com)" https://api.weather.gov/points/38.8894,-77.0352/forecast` |
| Hourly forecast | GET | `https://api.weather.gov/points/{lat},{lon}/forecast/hourly` | `lat` (decimal — required)  •  `lon` (decimal — required) | `curl -H "User-Agent: ClearNightSkyApp (contact@example.com)" https://api.weather.gov/points/38.8894,-77.0352/forecast/hourly` |
| Gridpoint data (raw fields) | GET | `https://api.weather.gov/gridpoints/{office}/{gridX},{gridY}` | `office` (string — required)  •  `gridX` (integer — required)  •  `gridY` (integer — required) | `curl -H "User-Agent: ClearNightSkyApp (contact@example.com)" https://api.weather.gov/gridpoints/LWX/96,70` |
| Gridpoint narrative forecast | GET | `https://api.weather.gov/gridpoints/{office}/{gridX},{gridY}/forecast` | `office` (string — required)  •  `gridX` (integer — required)  •  `gridY` (integer — required) | `curl -H "User-Agent: ClearNightSkyApp (contact@example.com)" https://api.weather.gov/gridpoints/LWX/96,70/forecast` |

## Usage Notes

- Use the **Resolve point metadata** endpoint first; its response contains the appropriate `forecast`, `forecastHourly`, and `forecastGridData` URLs for the provided coordinates.
- Cache the `/points` response where possible to avoid repeating the coordinate-to-grid lookup; the mapping changes infrequently.
- Parse the `forecastGridData` link to obtain `skyCover`, `probabilityOfPrecipitation`, `visibility`, and other time-series values relevant to predicting clear observing conditions.
