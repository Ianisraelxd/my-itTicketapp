import { useEffect, useMemo, useState } from "react";

import { api } from "./api";

// Answers to the two intake questions. The values are what the server's priority matrix reads.
const IMPACT_CHOICES = [
  { value: "Individual", label: "Just me" },
  { value: "Department", label: "My entire class" },
  { value: "Organization", label: "The whole building" },
];

const URGENCY_CHOICES = [
  { value: "High", label: "Right now for a live class" },
  { value: "Medium", label: "Within 2 days" },
  { value: "Low", label: "Next week" },
];

/**
 * Cascading Campus zone > Building > Room dropdown. There is no free-text entry:
 * `value` is the chosen room's location id (empty string until a room is picked).
 * Remount it (change its `key`) to clear the zone and building after a submit.
 */
export function LocationSelector({ value, onChange }) {
  const [state, setState] = useState({ status: "loading", rows: [] });
  const [attempt, setAttempt] = useState(0);
  const [zone, setZone] = useState("");
  const [building, setBuilding] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getLocations()
      .then((rows) => !cancelled && setState({ status: "ready", rows }))
      .catch(() => !cancelled && setState({ status: "error", rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const { rows, status } = state;
  const zones = useMemo(() => [...new Set(rows.map((row) => row.campusZone))], [rows]);
  const buildings = useMemo(
    () => [...new Set(rows.filter((row) => row.campusZone === zone).map((row) => row.buildingName))],
    [rows, zone],
  );
  const rooms = useMemo(
    () => rows.filter((row) => row.campusZone === zone && row.buildingName === building),
    [rows, zone, building],
  );

  const loading = status === "loading";
  const placeholder = (text) => (
    <option value="" disabled>
      {loading ? "Loading locations…" : text}
    </option>
  );

  function retry() {
    setState({ status: "loading", rows: [] });
    setAttempt((count) => count + 1);
  }

  return (
    <div className="location-selector" aria-busy={loading}>
      <div className="location-grid">
        <label className="field-label">
          Campus zone
          <select
            value={zone}
            disabled={loading || status === "error"}
            required
            onChange={(event) => {
              setZone(event.target.value);
              setBuilding("");
              onChange("");
            }}
          >
            {placeholder("Select a campus zone")}
            {zones.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Building
          <select
            value={building}
            disabled={loading || !zone}
            required
            onChange={(event) => {
              setBuilding(event.target.value);
              onChange("");
            }}
          >
            {placeholder("Select a building")}
            {buildings.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Room
          <select
            value={value}
            disabled={loading || !building}
            required
            onChange={(event) => onChange(event.target.value)}
          >
            {placeholder("Select a room")}
            {rooms.map((room) => (
              <option key={room.id} value={String(room.id)}>
                {room.roomName} ({room.roomType})
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && <div className="location-loading" aria-hidden="true" />}
      {status === "error" && (
        <p className="location-error" role="alert">
          Could not load the campus locations.{" "}
          <button type="button" className="link-button" onClick={retry}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}

/** The two mandatory questions that drive the automatic priority. */
export function IntakeQuestions({ impact, urgency, onImpact, onUrgency }) {
  return (
    <div className="form-grid">
      <label className="field-label">
        Who is affected?
        <select value={impact} required onChange={(event) => onImpact(event.target.value)}>
          <option value="" disabled>
            Select who is affected
          </option>
          {IMPACT_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        When do you need this?
        <select value={urgency} required onChange={(event) => onUrgency(event.target.value)}>
          <option value="" disabled>
            Select how soon
          </option>
          {URGENCY_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
