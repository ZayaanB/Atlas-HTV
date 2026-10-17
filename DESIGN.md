# Atlas — Night Earth · Dark

Approved reference: `docs/design-explorations/2026-10-17-earth-panels/night-dark-v2.png`. Use its material and hierarchy with dark Mapbox cartography, not simulated city-light imagery.

## Workspace

Full-screen globe, centered complete sphere on arrival, North America facing forward. No auto-rotation. Small wordmark upper left; coverage badge beneath; Search/News dock at bottom center; home/layers/zoom lower left. Attribution remains visible. One right-side content panel, closed initially; a bottom sheet below 1200px.

## Tokens

Background #07090d; opaque panel #111317; primary #f2f3f5; secondary #a5abb4; accent #74b9ff. System sans-serif; 14–15px body; 22–26px panel headings; 12px metadata. Fine dividers, 22px panel corners, capsule dock, restrained shadows. No decorative glass, dashboards, or permanent sidebars.

## Behavior

Panels preserve selection, filters, drafts, and navigation position. Search contains Search/Ask Atlas. News links to saved investigations and coverage. Investigation uses Brief/Timeline/Evidence/Sources. Short 220ms transitions, disabled under reduced motion. No route library or URL navigation in this slice.

## Truth and quality

Fixtures remain labeled everywhere. Dates retain their meaning. Broad places keep extents. API failures never silently switch to fixtures. Missing provider capabilities produce explicit unavailable states. Use one Mapbox instance, restore layers on style reload, cancel stale assistant actions, and keep aircraft selection separate.
