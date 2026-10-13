import { useEffect, useState } from "react";

import { api } from "./api";

/** A photo in the conversation. The picture needs the sign-in token, so it is fetched and shown from memory. */
export default function PhotoMessage({ id, name, userId }) {
  const [state, setState] = useState({ url: null, failed: false });

  useEffect(() => {
    let active = true;
    let objectUrl = null;
    api
      .getAttachmentBlob(id, userId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setState({ url: objectUrl, failed: false });
      })
      .catch(() => active && setState({ url: null, failed: true }));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, userId]);

  if (state.failed) return <span className="photo-missing">📷 {name} (the photo is no longer available)</span>;
  if (!state.url) return <span className="photo-loading" aria-busy="true" />;
  return (
    <a href={state.url} target="_blank" rel="noreferrer" className="photo-link" title="Open the full picture">
      <img src={state.url} alt={`Photo: ${name}`} loading="lazy" />
    </a>
  );
}
