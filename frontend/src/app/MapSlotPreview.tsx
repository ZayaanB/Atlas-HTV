import { useEffect, useState } from 'react';
import type { AtlasMapProps, CameraCommand } from './map-interface';

/** Temporary handoff preview. Person 2 supplies the geographic renderer. */
export function MapSlotPreview(props: AtlasMapProps) {
  const [lastCommand, setLastCommand] = useState<CameraCommand | null>(null);
  const { cameraCommand, onCameraCommandHandled } = props;
  useEffect(() => {
    if (cameraCommand) {
      setLastCommand(cameraCommand);
      onCameraCommandHandled(cameraCommand.id);
    }
  }, [cameraCommand, onCameraCommandHandled]);
  return <section className="map-preview" aria-label="Map preview">
    <span className="eyebrow">Geographic context</span>
    <h2>Your place in the story</h2>
    <p>Map rendering is awaiting integration. These sourced locations belong to the current feed page.</p>
    {props.status.state === 'loading' && <p role="status">Loading geographic context…</p>}
    {props.status.error && <p role="alert">{props.status.error}</p>}
    <ul className="places">{props.locations.map(location => <li key={location.id}>
      <button aria-pressed={props.selection.locationId === location.id} onClick={() => props.onSelect({
        articleId: props.articles.find(a => a.location_ids.includes(location.id))?.id ?? null, locationId: location.id
      })}>{location.name} <small>{location.precision}</small></button>
      {import.meta.env.DEV && location.bounds && <button className="secondary" onClick={() => {
        const [w, s, e, n] = location.bounds!;
        props.onViewportChange({ bounds: location.bounds!, center: [(w + e) / 2, (s + n) / 2], zoom: 0 });
      }}>Preview search area: {location.name}</button>}
      {import.meta.env.DEV && location.coordinates && <button className="secondary" onClick={() => props.onInspectCoordinates(location.coordinates!)}>Inspect sourced coordinates</button>}
    </li>)}</ul>
    {props.status.missingLocationIds.length > 0 && <p role="status">Some articles have unresolved locations and cannot be placed.</p>}
    {import.meta.env.DEV && <p className="muted" aria-live="polite">Camera preview: {lastCommand?.type.replaceAll('_', ' ') ?? 'no command'}.</p>}
  </section>;
}
