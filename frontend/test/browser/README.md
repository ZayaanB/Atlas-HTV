# Local global-flight browser verification

This test-only entry renders the real App and AtlasMap. A Mapbox subclass replaces styles with a local empty style, uses local fonts, disables performance metrics, and redirects its API base to localhost. Browser automation blocks every external request, including telemetry. The injected fetch returns synthetic global responses through `createHttpApi`, so the production response validator still runs. News/research are explicitly labeled historical fixtures. It is never imported by the production entry and does not use real credentials, providers or a database.

Build contracts and run from the repository root:

```sh
npm --prefix contracts run build
VITE_MAPBOX_ACCESS_TOKEN=synthetic-local-only VITE_DATA_MODE=api npm --prefix frontend run dev -- --port 5188
```

Open `http://127.0.0.1:5188/test/browser/global-flights.html`. In browser automation, block all non-local requests before navigation and fulfill `/test/browser/empty-glyphs/**` with an empty protobuf response. Enable Flights in Map layers. The initial response supplies 7,500 aircraft and eight observations per aircraft. There is no provider request when panning or searching.

The browser console exposes `window.flightHarness`. Useful awaited commands:

```js
await flightHarness.load(0); // clear before measuring a fresh replacement
await flightHarness.load(7500); // returns generation, validation, source readiness and counts
await flightHarness.load(7500, 300000); // five-minute observation update, one-second animation
await flightHarness.load(0);
await flightHarness.load(25000); // full schema safety boundary, explicitly truncated
flightHarness.counts();
flightHarness.writes(); // compare two readings across 1.1 s idle: no flight writes
flightHarness.fetches(); // synthetic Atlas requests only
flightHarness.map().setStyle({version: 8, sources: {}, layers: []}); // local style replacement
await flightHarness.settled(25000);
```

`load` validates and inserts a synthetic server response in Query to measure the data/rendering path independently of the scheduler. Scheduler timing/cancellation/pause behavior is covered with fake clocks in `global-flights.test.tsx`. The initial browser request exercises the real API adapter against an injected Response. This harness is not a production fallback.

Check 1440×960 and 390×844 viewports: local keyboard search (two characters, maximum 50 matches/refinement message), provider units/codes/direction/unknown fields, selection and Back without camera motion, style restoration, no global coverage source, no idle flight source writes, and toggle cleanup while retaining news. Select an aircraft then load zero to verify missing details without markers. Reduced motion and transition interruptions also have deterministic map-layer tests. Viewport emulation is not physical-device evidence. Measured results are in [map handoff](../../docs/map-handoff.md).
