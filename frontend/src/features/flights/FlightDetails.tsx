import type { useFlightOverlay } from '../../lib/flights';
import { dateTime } from '../../lib/presentation';

export function FlightDetails({ flights }: { flights: ReturnType<typeof useFlightOverlay> }) {
  const aircraft = flights.selected;
  if (!aircraft) return <p>Aircraft details are unavailable.</p>;
  return <section aria-label="Selected aircraft">
    <h2>{aircraft.callsign || aircraft.registration || aircraft.id}</h2>
    <div className="flight-availability" role="status">
      {flights.selectedMissing && <p>Not in the latest sample.</p>}
      {flights.selectedOutside && <p>Last position is outside the loaded coverage circle.</p>}
      {flights.selectedExpired ? <p>Position expired · historical details retained.</p>
        : flights.selectedMissing ? <p>Last-known position.</p> : null}
      <p>Observed {Math.max(0, Math.floor((flights.now - Date.parse(aircraft.observed_at)) / 1000))}s ago{flights.stale ? ' · stale sample' : ''}.</p>
      <p>{flights.selectedAttribution}</p>
      {flights.updatingArea && <p>Updating area · positions and circle show the preceding sample.</p>}
    </div>
    <dl className="metadata">
      <dt>Aircraft ID</dt><dd>{aircraft.id}</dd>
      <dt>Callsign</dt><dd>{aircraft.callsign || 'Unknown'}</dd>
      <dt>Registration</dt><dd>{aircraft.registration || 'Unknown'}</dd>
      <dt>Aircraft type</dt><dd>{aircraft.aircraft_type || 'Unknown'}</dd>
      <dt>Operator</dt><dd>{aircraft.operator || 'Unknown'}</dd>
      {aircraft.provider === 'airlabs' && <>
        <dt>Flight identifier (IATA)</dt><dd>{aircraft.flight_iata || 'Unknown'}</dd>
        <dt>Airline code (ICAO)</dt><dd>{aircraft.airline_icao || 'Unknown'}</dd>
        <dt>Airline code (IATA)</dt><dd>{aircraft.airline_iata || 'Unknown'}</dd>
        <dt>Reported departure (IATA)</dt><dd>{aircraft.departure_iata || 'Unknown'}</dd>
        <dt>Reported arrival (IATA)</dt><dd>{aircraft.arrival_iata || 'Unknown'}</dd>
      </>}
      <dt>Altitude</dt><dd>{aircraft.altitude === null ? 'Unknown' : `${aircraft.altitude.toLocaleString()} ${aircraft.altitude_unit} · ${aircraft.altitude_reference === 'unknown' ? 'reference unknown' : aircraft.altitude_reference}`}</dd>
      <dt>Groundspeed</dt><dd>{aircraft.speed === null ? 'Unavailable' : `${aircraft.speed} ${aircraft.speed_unit}`}</dd>
      <dt>{aircraft.direction_kind === 'direction' ? 'Direction' : 'Ground track'}</dt><dd>{aircraft.heading === null ? 'Unknown' : `${aircraft.heading}°`}</dd>
      <dt>Ground state</dt><dd>{aircraft.on_ground == null ? 'Unknown' : aircraft.on_ground ? 'On ground' : 'Airborne'}</dd>
      <dt>Position · lon, lat</dt><dd>{aircraft.coordinates.join(', ')}</dd>
      <dt>Observed (UTC)</dt><dd>{dateTime(aircraft.observed_at)}</dd>
      <dt>Fetched (UTC)</dt><dd>{dateTime(aircraft.fetched_at)}</dd>
    </dl>
    <p className="notice">Positions do not establish routes, delays, emergencies, or news impact.</p>
    {flights.mode === 'global' && <p className="muted">Observed positions · last 30 minutes. Reported airport codes do not describe an observed full route.</p>}
    <a href={aircraft.source_url} target="_blank" rel="noopener noreferrer">{aircraft.provider === 'airlabs' ? 'AirLabs' : 'ADSB.lol'} · Original source ↗</a>
  </section>;
}
