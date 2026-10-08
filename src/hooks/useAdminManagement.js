import { useEffect, useState } from "react";

import { api } from "../api";

// Logic for the privileged-accounts table: list, grant, revoke, unlock, reset MFA.
export default function useAdminManagement({ onMessage }) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState({ version: -1, admins: [], candidates: [], error: null });
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .getPrivilegedAccounts()
      .then((data) => active && setLoaded({ version, admins: data.admins, candidates: data.candidates, error: null }))
      .catch((error) =>
        active && setLoaded({ version, admins: [], candidates: [], error: error.message || "Could not load." }),
      );
    return () => {
      active = false;
    };
  }, [version]);

  const reload = () => setVersion((value) => value + 1);

  const SUCCESS = {
    revoke: "Access revoked. They are an Employee again.",
    grant: "Admin access granted. They need to log in again as an Admin.",
    grant_viewer: "Report viewer access granted. They need to log in again as a Report Viewer.",
    unlock: "The lockout was cleared. They can sign in again.",
    reset_mfa: "Two-step verification was reset. They can set it up again from their profile.",
  };

  async function act(userId, action, name) {
    setBusyId(userId);
    try {
      await api.manageAccount(userId, action);
      onMessage("Done", `${name}: ${SUCCESS[action]}`);
      reload();
      return true;
    } catch (error) {
      onMessage("Could not update the account", error.message || "Please try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return {
    isLoading: loaded.version !== version,
    error: loaded.version === version ? loaded.error : null,
    admins: loaded.admins,
    candidates: loaded.candidates,
    busyId,
    act,
    reload,
  };
}
