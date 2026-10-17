import type { WorkspaceResponse } from "@atlas/contracts";
import { useState } from "react";
import { readContract } from "../../lib/validation";
export function SavedInvestigations({
  ids,
  catalog,
  onOpen,
  onRemove,
}: {
  ids: string[];
  catalog?: WorkspaceResponse | undefined;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [id, setId] = useState(""),
    [error, setError] = useState("");
  return (
    <section aria-label="Saved investigations">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const query = readContract("InvestigationQuery", { id: id.trim() });
            setError("");
            onOpen(query.id);
          } catch {
            setError(
              "Enter a valid investigation ID from a shared research record.",
            );
          }
        }}
      >
        <label htmlFor="investigation-id">Open investigation by ID</label>
        <input
          id="investigation-id"
          value={id}
          maxLength={160}
          onChange={(event) => setId(event.target.value)}
          placeholder="Investigation ID"
        />
        <button className="text-button" disabled={!id.trim()}>
          Open investigation
        </button>
        <p className="muted">
          Use an ID from a shared research record. Availability is checked with
          the server.
        </p>
        {error && <p role="alert">{error}</p>}
      </form>
      {ids.length ? (
        <ul className="plain-list">
          {ids.map((id) => {
            const record = catalog?.investigations.find((i) => i.id === id);
            return (
              <li className="saved-row" key={id}>
                <button className="headline" onClick={() => onOpen(id)}>
                  {record?.title ?? id}
                </button>
                <button className="text-button" onClick={() => onRemove(id)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-state">
          <h2>Keep a thread.</h2>
          <p>
            Save an investigation to return to its reporting, evidence, and
            sources. Saved IDs stay in this browser.
          </p>
        </div>
      )}
    </section>
  );
}
