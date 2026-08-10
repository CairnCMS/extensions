# Address Completion

Address Completion is a field interface backed by Google Places. An editor types an address or place name, picks a suggestion from a dropdown, and the field saves one compact address record with the formatted address, the Google place ID, and coordinates. A matching display renders the saved address in tables and layouts.

Searches run through the extension's own server endpoint inside CairnCMS. The Google key stays on the server, the admin app loads no Google JavaScript, and a base install needs no content security policy changes. An optional embedded map is available for fields that want visual confirmation, and enabling it is the one feature that loads Google JavaScript in the browser.

Use this when editors enter real-world places, such as store locations, dealers, venues, or customer addresses, and your frontend needs coordinates or a durable place reference along with the address text.

## Requirements

- CairnCMS 1.3.0 or later, with `SECRETS_ENCRYPTION_KEY` set in the deployment environment. Saving the Google key fails with a configuration error without it. See [Configuration](https://cairncms.dev/docs/manage/configuration/).
- A Google Cloud project with billing enabled.
- The Places API (New) service enabled on that project.
- For the optional map: the Maps JavaScript API service, a browser key, a Map ID, and the CSP additions described below.
- Admin access to CairnCMS for the one-time configuration.

## Installation

CairnCMS discovers the extension either from the project's `extensions` folder or from its `node_modules`. Pick the method that fits your deployment. After any of them, restart CairnCMS and check that Settings > Extensions shows an Address Completion row with a Normal health indicator.

### Into the extensions folder

Fits the default Docker project from `cairncms init`, which mounts `./extensions` into the container, and any other deployment with a writable extensions folder:

```bash
cd <cairncms-project-folder>
npm pack @cairncms/extension-address-completion
mkdir -p extensions/cairncms-extension-address-completion
tar -xzf cairncms-extension-address-completion-*.tgz -C extensions/cairncms-extension-address-completion --strip-components=1
rm cairncms-extension-address-completion-*.tgz
docker compose restart cairncms
```

### As an npm dependency

Fits deployments where you control the CairnCMS project folder and its `node_modules`:

```bash
cd <cairncms-project-folder>
npm install @cairncms/extension-address-completion
```

The loader auto-discovers the package from `node_modules` at startup.

### In a custom Docker image

Fits image-based deployments without writable mounts:

```dockerfile
FROM node:22-alpine AS extensions
WORKDIR /ext
RUN npm pack @cairncms/extension-address-completion && \
	mkdir -p address-completion && \
	tar -xzf cairncms-extension-address-completion-*.tgz -C address-completion --strip-components=1

FROM cairncms/cairncms:1.3.0
COPY --from=extensions --chown=node:node /ext/address-completion /cairncms/extensions/cairncms-extension-address-completion
```

In a production Dockerfile, pin an exact version, for example `@cairncms/extension-address-completion@0.1.0`, so image rebuilds stay reproducible.

## Set up Google Cloud

Address search requires the Places API (New) and a server API key. The optional map also requires the Maps JavaScript API, a browser API key, and a Map ID.

1. Create or select a Google Cloud project and enable billing.
2. Enable **Places API (New)** under APIs & Services > Library.
3. Create an API key and restrict it to **Places API (New)**. If your server has stable egress IP addresses, add them as an application restriction.
4. For the optional map, enable **Maps JavaScript API**, create a website-restricted key for your CairnCMS origin, and create a JavaScript Map ID under Google Maps Platform > Map Management.

### Troubleshooting

- If Google reports that the Places API has not been used or is disabled, confirm that **Places API (New)** is enabled. The legacy Places API is a different service.
- If the browser reports `ApiNotActivatedMapError`, enable **Maps JavaScript API**.

## Configure the extension settings

Open Settings > Extensions, find the Address Completion row, and open its Settings action:

- `google_maps_api_key` (required): the server key. This is a declared secret. CairnCMS encrypts it at rest, never sends it to the browser, and shows a saved state instead of the value after you store it.
- `google_maps_browser_key` (optional): the browser key for the map. This value is public. Every app user can read it, and it appears in the map script address in the browser. The settings drawer shows it in plain text because it is not a secret.
- `google_maps_map_id` (optional): the Map ID for the map. Also public.

[Google recommends](https://developers.google.com/maps/api-security-best-practices) separate API keys for each application and platform. Use separate server and browser keys when possible. A shared key works, but it cannot use an application restriction suitable for both server and browser requests.

## Add a field

1. Open Settings > Data Model and pick a collection.
2. Create a field with type JSON and choose the Address Completion interface.
3. Optionally set the field's display to Address Completion, so tables and layouts render the saved address instead of raw JSON.

### Field options

**Countries** restricts suggestions to up to 15 countries. Empty means worldwide.

**Search scope** controls what kinds of places can be suggested:

- All places: street addresses, businesses, points of interest, cities, and regions.
- Addresses: street addresses, buildings, units, roads, and postal codes only.
- Cities: cities and towns.
- Regions: states, counties, and other larger areas.

Whatever the scope, the field only ever saves the address record of the chosen place. Business names and other place details are not stored.

**Location bias** ranks suggestions near a chosen area without excluding other results. Use it when editors usually search in one region. Enter latitude, longitude, and radius together, or leave all three blank. The radius can be 100 to 50,000 meters.

**Show map** renders an embedded Google map under the field with a marker on the saved address. It requires the browser key and Map ID settings and the CSP additions below, and it is the only feature that loads Google JavaScript into the admin app.

## What gets saved

The field holds one JSON value with exactly two shapes. Picking a suggestion saves the full record:

```json
{
	"version": 1,
	"formattedAddress": "30 W Pershing Rd, Kansas City, MO 64108, USA",
	"placeId": "ChIJxbu2nD_wwIcR3cdZjUGmRhc",
	"location": {
		"latitude": 39.0846332,
		"longitude": -94.5850238,
		"observedAt": "2026-08-09T14:22:24.388Z"
	},
	"components": {
		"locality": "Kansas City",
		"region": "MO",
		"postalCode": "64108",
		"countryCode": "US"
	}
}
```

Typing text without picking a suggestion saves a manual record, so hand-typed text never carries stale coordinates:

```json
{ "version": 1, "formattedAddress": "Warehouse dock 3, rear entrance" }
```

Clearing the field saves `null`. Keys with no data are omitted. `components` is optional, `region` uses the short form (`MO`), and `countryCode` is ISO 3166-1 alpha-2.

A frontend reads the value directly, checking for the full record first, since a manual record has no `location`:

```js
if (dealer.address?.location) {
	const { latitude, longitude } = dealer.address.location;
}
```

The display's template option renders any path inside the record, for example `{{ components.locality }}` or `{{ location.latitude }}`. Displays change rendering only. Sorting or filtering a collection by city or region needs those values in flat fields, which this extension does not write.

If a field holds a value from another source that does not match this shape, the interface shows a notice and leaves the value untouched until an editor clears it.

## Data flow

Search requests travel from the editor's browser to your CairnCMS server, and from there to Google. The typed search text and the chosen place ID are sent to Google under your server key. The extension debounces requests while typing, asks Google for only the fields it stores, and manages Google's autocomplete session tokens, which group each search-and-selection sequence into one Google billing session.

Search is available to any signed-in user with app access, and the endpoint does not meter aggregate usage. Quota caps and billing alerts in the Google Cloud console are the aggregate spend controls. The optional CairnCMS [rate limiters](https://cairncms.dev/docs/manage/configuration/) can additionally slow individual clients, and the standard limiter is per client IP, with a separate global limiter for instance-wide caps.

With the map disabled, the admin app never connects to Google. With the map enabled, the browser additionally loads the Maps JavaScript API on Google's quarterly channel using the browser key.

## Google Places data

Selected records contain data returned by Google Places. Review [Google's Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) and [service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) for requirements that apply to your use. Each record includes `observedAt`, and editors can refresh it from its place ID.

## CSP for the map

A base install needs no content security policy changes. Enabling the map loads Google JavaScript, tiles, and imagery in the browser, which the default policy blocks. Set these three directives in the deployment environment:

```
CONTENT_SECURITY_POLICY_DIRECTIVES__SCRIPT_SRC="array:'self', 'unsafe-eval', https://*.googleapis.com, https://*.gstatic.com, *.google.com, https://*.ggpht.com, *.googleusercontent.com, blob:"
CONTENT_SECURITY_POLICY_DIRECTIVES__IMG_SRC="array:'self', data:, blob:, https://*.googleapis.com, https://*.gstatic.com, *.google.com, *.googleusercontent.com"
CONTENT_SECURITY_POLICY_DIRECTIVES__CONNECT_SRC="array:'self', https://a.tile.openstreetmap.org, https://b.tile.openstreetmap.org, https://c.tile.openstreetmap.org, https://fonts.openmaptiles.org, https://api.mapbox.com, https://*.googleapis.com, *.google.com, https://*.gstatic.com, data:, blob:"
```

Keep the non-Google entries. `connect-src` in particular replaces the CairnCMS defaults instead of extending them, and the OpenStreetMap and Mapbox origins in the list are what keep the built-in map interface working.

## License

GPL-3.0-only. The built package bundles third-party material with its own terms, listed in `THIRD_PARTY_NOTICES.md`.
