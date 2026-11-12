import { encode } from "uqr";

// The quiet zone a QR code needs around it for a scanner to find it: four modules on each side.
const QUIET_ZONE = 4;

/**
 * The QR code of `text` as one SVG path in a square of `size` modules, its quiet zone included: each run of dark
 * modules along a row is one rectangle.
 * @param {string} text
 * @returns {{ size: number, path: string }}
 */
function qrCodePath(text) {
  const { size, data } = encode(text, { border: QUIET_ZONE });
  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x]) {
        x += 1;
      }
      path += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  });
  return { size, path };
}

export { qrCodePath };
