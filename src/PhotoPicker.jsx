import { useEffect, useMemo } from "react";

import { PHOTO_TYPES } from "./imageTools";

export const MAX_FORM_PHOTOS = 3;

/** Optional photos on the request form. `files` is an array of File objects kept by the form. */
export default function PhotoPicker({ files, onChange }) {
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((item) => URL.revokeObjectURL(item.url)), [previews]);

  function pick(event) {
    const chosen = [...event.target.files].filter((file) => PHOTO_TYPES.includes(file.type));
    onChange([...files, ...chosen].slice(0, MAX_FORM_PHOTOS));
    event.target.value = "";
  }

  return (
    <div className="photo-picker">
      <span className="field-label-text">Photos (optional)</span>
      <div className="photo-picker-row">
        {previews.map((item, index) => (
          <figure key={item.url}>
            <img src={item.url} alt={`Selected photo ${index + 1}`} />
            <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => onChange(files.filter((_, i) => i !== index))}>
              ×
            </button>
          </figure>
        ))}
        {files.length < MAX_FORM_PHOTOS && (
          <label className="photo-add">
            <span aria-hidden="true">＋</span>
            <small>Add a photo</small>
            <input type="file" accept={PHOTO_TYPES.join(",")} multiple onChange={pick} />
          </label>
        )}
      </div>
      <small className="photo-hint">A picture of the screen, the error message or the broken part helps us fix it faster. Up to {MAX_FORM_PHOTOS}.</small>
    </div>
  );
}
