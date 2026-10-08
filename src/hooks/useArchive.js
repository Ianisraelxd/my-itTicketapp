import { useEffect, useState } from "react";

import { api } from "../api";

// Logic for the archiving module: numbers, run history, preview and the
// "Mass Export & Archive" action. The component only renders what this returns.
export default function useArchive({ onMessage }) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState({ version: -1, overview: null, runs: [], error: null });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null); // "preview" | "archive" | null

  useEffect(() => {
    let active = true;
    Promise.all([api.getGovernanceOverview(), api.getArchiveRuns()])
      .then(([overview, runs]) => active && setLoaded({ version, overview, runs, error: null }))
      .catch((error) =>
        active && setLoaded({ version, overview: null, runs: [], error: error.message || "Could not load." }),
      );
    return () => {
      active = false;
    };
  }, [version]);

  const reload = () => setVersion((value) => value + 1);

  async function previewCutoff(before) {
    setBusy("preview");
    try {
      setPreview(await api.previewArchive(before));
    } catch (error) {
      setPreview(null);
      onMessage("Could not check the date", error.message || "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  // Returns the result (or null on failure) so the UI can show what happened.
  async function runArchive(before) {
    setBusy("archive");
    try {
      const result = await api.runArchive(before);
      setPreview(null);
      reload();
      return result;
    } catch (error) {
      onMessage("Archive failed", error.message || "Nothing was deleted. Please try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function downloadRun(runId, format) {
    try {
      await api.downloadArchive(runId, format);
    } catch (error) {
      onMessage("Could not download", error.message || "Please try again.");
    }
  }

  return {
    isLoading: loaded.version !== version,
    error: loaded.version === version ? loaded.error : null,
    overview: loaded.overview,
    runs: loaded.runs,
    preview,
    busy,
    previewCutoff,
    runArchive,
    downloadRun,
    clearPreview: () => setPreview(null),
    reload,
  };
}
