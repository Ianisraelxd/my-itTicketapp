// Gets a photo ready to upload: phone pictures are often 5 to 10 MB, so they are shrunk first
// (longest side 1600 px, JPEG). GIFs are sent as they are so they keep moving.
export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_SIDE = 1600;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as a picture."));
    };
    image.src = url;
  });
}

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(blob);
  });

/** @returns {Promise<{name: string, data: string}>} data is base64 without the data: prefix */
export async function prepareImage(file) {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error("Choose a PNG, JPEG, GIF or WebP picture.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That picture is too large (25 MB at most).");
  if (file.type === "image/gif") {
    if (file.size > 5 * 1024 * 1024) throw new Error("GIF pictures can be up to 5 MB.");
    return { name: file.name, data: await toBase64(file) };
  }
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff"; // transparent PNGs get a white background instead of black
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("The photo could not be prepared.");
  if (blob.size > 5 * 1024 * 1024) throw new Error("That picture is still over 5 MB after shrinking it.");
  return { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", data: await toBase64(blob) };
}
