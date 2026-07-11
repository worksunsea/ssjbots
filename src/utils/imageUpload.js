// Magic byte signatures for allowed image formats
const MAGIC = {
  jpeg: [[0xFF, 0xD8, 0xFF]],
  png:  [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  webp: null, // checked separately (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  gif:  [[0x47, 0x49, 0x46, 0x38]],
};

const MAX_BYTES = 12;

async function readMagicBytes(file) {
  const buf = await file.slice(0, MAX_BYTES).arrayBuffer();
  return new Uint8Array(buf);
}

function matchesMagic(bytes, sig) {
  return sig.every((b, i) => bytes[i] === b);
}

function detectImageType(bytes) {
  for (const [fmt, sigs] of Object.entries(MAGIC)) {
    if (fmt === "webp") continue;
    if (sigs && sigs.some((sig) => matchesMagic(bytes, sig))) return fmt;
  }
  // WebP: RIFF????WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  return null;
}

// Compress/resize image via Canvas. Returns a Blob.
// GIF passes through unmodified (canvas loses animation).
async function compressImage(file, detectedType, maxDim = 1920, quality = 0.85) {
  if (detectedType === "gif") return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height / width) * maxDim);
          width = maxDim;
        } else {
          width = Math.round((width / height) * maxDim);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // PNG keeps alpha; everything else → JPEG (better WA compatibility + smaller)
      const outMime = detectedType === "png" ? "image/png" : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error("Canvas compression failed")); return; }
          resolve(blob);
        },
        outMime,
        outMime === "image/jpeg" ? quality : undefined
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image failed to load — file may be corrupted"));
    };

    img.src = url;
  });
}

/**
 * Validate, compress, and upload an image file to Supabase storage.
 *
 * @param {File} file - The raw file from the input element
 * @param {object} supabase - Supabase client
 * @param {string} folder - Subfolder within uploads/ (e.g. "walkin-refs")
 * @param {object} [opts]
 * @param {number} [opts.maxDim=1920] - Max width/height in pixels
 * @param {number} [opts.quality=0.85] - JPEG quality 0-1
 * @param {number} [opts.maxFileMB=10] - Max original file size in MB
 * @param {string} [opts.fileNameOverride] - Use this instead of {timestamp}_{original name}
 *   (extension is still derived from the detected image type). e.g. "CKGAT-0001_1".
 * @returns {Promise<{publicUrl: string, compressedSize: number}>}
 */
/**
 * Validate + compress an image WITHOUT uploading — pure client-side Canvas
 * work, needs no network. Used to shrink photos before queueing them in
 * IndexedDB for offline sync, so a phone captured with no signal doesn't
 * accumulate full-size camera photos (several MB each) locally while queued.
 * @returns {Promise<Blob>}
 */
export async function compressImageOnly(file, opts = {}) {
  const { maxDim = 1600, quality = 0.85, maxFileMB = 10 } = opts;
  if (file.size > maxFileMB * 1024 * 1024) {
    throw new Error(`File too large. Maximum allowed size is ${maxFileMB} MB.`);
  }
  const bytes = await readMagicBytes(file);
  const detectedType = detectImageType(bytes);
  if (!detectedType) {
    throw new Error("Invalid file. Only JPEG, PNG, WebP, and GIF images are allowed.");
  }
  return compressImage(file, detectedType, maxDim, quality);
}

export async function secureImageUpload(file, supabase, folder, opts = {}) {
  const { maxDim = 1920, quality = 0.85, maxFileMB = 10, fileNameOverride } = opts;

  // 1. Size guard
  if (file.size > maxFileMB * 1024 * 1024) {
    throw new Error(`File too large. Maximum allowed size is ${maxFileMB} MB.`);
  }

  // 2. Magic-byte validation — reject anything that isn't a real image
  const bytes = await readMagicBytes(file);
  const detectedType = detectImageType(bytes);
  if (!detectedType) {
    throw new Error(
      "Invalid file. Only JPEG, PNG, WebP, and GIF images are allowed."
    );
  }

  // 3. Compress + strip EXIF via Canvas redraw
  const compressed = await compressImage(file, detectedType, maxDim, quality);

  // 4. Build safe path under uploads/
  const ext = detectedType === "png" ? "png" : detectedType === "gif" ? "gif" : "jpg";
  const baseName = fileNameOverride
    ? fileNameOverride.replace(/[^a-zA-Z0-9._-]/g, "_")
    : `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "")}`;
  const path = `uploads/${folder}/${baseName}.${ext}`;

  // 5. Upload
  const { error } = await supabase.storage
    .from("media")
    .upload(path, compressed, { upsert: true, contentType: compressed.type });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data: pub } = supabase.storage.from("media").getPublicUrl(path);

  return { publicUrl: pub.publicUrl, compressedSize: compressed.size };
}

/**
 * Validate and upload a non-image file (PDF, video) — no compression.
 * Still checks that the file type matches an expected set.
 */
export async function secureNonImageUpload(file, supabase, folder, allowedMimes, maxFileMB = 50) {
  if (file.size > maxFileMB * 1024 * 1024) {
    throw new Error(`File too large. Maximum allowed size is ${maxFileMB} MB.`);
  }

  if (!allowedMimes.includes(file.type)) {
    throw new Error(`File type "${file.type}" is not allowed.`);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `uploads/${folder}/${Date.now()}_${safeName}`;

  const { error } = await supabase.storage
    .from("media")
    .upload(path, file, { upsert: true });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
  return { publicUrl: pub.publicUrl };
}
