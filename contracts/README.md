# Shared contracts — Person 1

Reserved for runtime schemas, matching TypeScript types, and fixture examples agreed with Person 3. No schemas or example data have been invented in this scaffold.

Agree Article, Location, Investigation, Evidence, Observation, AircraftState, Filters, AssistantRequest/Response, UI actions, coverage metadata, and errors before implementing consumers. Use longitude–latitude, UTC timestamps, explicit missing values, source IDs, and geographic precision. Distinguish event/publication/observation/fetch times.

Person 2 consumes location/aircraft/map-action contracts. Person 4 aligns seeded records and database columns with these contracts. Keep one authoritative definition rather than backend/frontend duplicates.
