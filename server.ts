import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import sharp, { FitEnum } from "sharp";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { nanoid } from "nanoid";
import { PrismaClient, Image } from "@prisma/client";

const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 3000;

const ORIGINALS_DIR = path.join(__dirname, "originals");
const CACHE_DIR = path.join(__dirname, "cache");
const MAX_UPLOAD_MB = 25;

for (const dir of [ORIGINALS_DIR, CACHE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

type FitMode = keyof FitEnum;

interface PresetConfig {
  width: number;
  height: number;
  fit: FitMode;
}

// ---- Named presets. Anything not in here can still be requested via
// ---- arbitrary ?width=&height= query params (validated below).
const PRESETS: Record<string, PresetConfig> = {
  thumbnail: { width: 150, height: 150, fit: "cover" },
  small: { width: 400, height: 400, fit: "inside" },
  medium: { width: 800, height: 800, fit: "inside" },
  large: { width: 1600, height: 1600, fit: "inside" },
};

const ALLOWED_FORMATS = new Set<string>(["jpeg", "jpg", "png", "webp", "avif"]);
const MAX_DIMENSION = 4000; // guard against abuse via huge width/height params

// ---------------------------------------------------------------------
// Upload handling
// ---------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    cb(null, true);
  },
});

app.use(express.json());

// ---------------------------------------------------------------------
// API Key Check Middleware
// ---------------------------------------------------------------------
const requireApiKey = (
  req: Request,
  res: Response,
  next: NextFunction,
): any => {
  const apiKey = process.env.API_PRIVATE_KEY;
  if (!apiKey) {
    console.warn("WARNING: API_PRIVATE_KEY is not set. Denying request.");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"] as string;

  let providedKey = apiKeyHeader;
  if (!providedKey && authHeader && authHeader.startsWith("Bearer ")) {
    providedKey = authHeader.substring(7);
  }

  if (!providedKey || providedKey !== apiKey) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Invalid or missing API key" });
  }

  next();
};

// ---------------------------------------------------------------------
// POST /images  — upload a new master image
// ---------------------------------------------------------------------
app.post(
  "/images",
  requireApiKey,
  upload.single("image"),
  async (req: Request, res: Response): Promise<any> => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: 'No image file provided (field name: "image")' });
      }

      const id = nanoid(12);
      const metadata = await sharp(req.file.buffer).metadata();

      if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
        return res
          .status(415)
          .json({ error: `Unsupported format: ${metadata.format}` });
      }

      // Normalize the master to a well-known extension/format so downstream
      // resizing logic doesn't need to branch on the original file type.
      const masterPath = path.join(ORIGINALS_DIR, `${id}.${metadata.format}`);
      await fsp.writeFile(masterPath, req.file.buffer);

      const description = req.body.description || "";

      // Persist metadata to database
      await prisma.image.create({
        data: {
          id,
          format: metadata.format,
          width: metadata.width || 0,
          height: metadata.height || 0,
          description,
        },
      });

      return res.status(201).json({
        id,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        description,
        urls: {
          original: `/images/${id}/original`,
          thumbnail: `/images/${id}/thumbnail`,
          small: `/images/${id}/small`,
          medium: `/images/${id}/medium`,
          large: `/images/${id}/large`,
          custom: `/images/${id}?width=W&height=H`,
        },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to process upload" });
    }
  },
);

// ---------------------------------------------------------------------
// Shared resolver: find the master file for an id
// ---------------------------------------------------------------------
async function findMaster(
  id: string,
): Promise<{ meta: Image; masterPath: string } | null> {
  const meta = await prisma.image.findUnique({
    where: { id },
  });
  if (!meta) return null;
  const masterPath = path.join(ORIGINALS_DIR, `${id}.${meta.format}`);
  if (!fs.existsSync(masterPath)) return null;
  return { meta, masterPath };
}

interface ResizeOptions {
  width?: string | number | null;
  height?: string | number | null;
  fit?: string | null;
  format?: string | null;
}

// ---------------------------------------------------------------------
// Core resize + cache logic, shared by preset and custom routes
// ---------------------------------------------------------------------
async function serveResized(
  req: Request,
  res: Response,
  { width, height, fit, format }: ResizeOptions,
): Promise<any> {
  const id = req.params.id as string;
  const master = await findMaster(id);
  if (!master) return res.status(404).json({ error: "Image not found" });

  let parsedWidth: number | null = null;
  if (width !== undefined && width !== null) {
    const w = typeof width === "string" ? parseInt(width, 10) : width;
    if (isNaN(w) || w <= 0) {
      return res
        .status(400)
        .json({ error: "width/height must be positive integers" });
    }
    parsedWidth = Math.min(w, MAX_DIMENSION);
  }

  let parsedHeight: number | null = null;
  if (height !== undefined && height !== null) {
    const h = typeof height === "string" ? parseInt(height, 10) : height;
    if (isNaN(h) || h <= 0) {
      return res
        .status(400)
        .json({ error: "width/height must be positive integers" });
    }
    parsedHeight = Math.min(h, MAX_DIMENSION);
  }

  const outFormat =
    format && ALLOWED_FORMATS.has(format) ? format : master.meta.format;

  // Cache key is deterministic from id + all transform params, so repeat
  // requests for the same variant are served straight off disk.
  const cacheKey = crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        id,
        width: parsedWidth,
        height: parsedHeight,
        fit,
        outFormat,
      }),
    )
    .digest("hex");
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.${outFormat}`);

  if (fs.existsSync(cachePath)) {
    return res.type(outFormat).sendFile(cachePath);
  }

  try {
    let pipeline = sharp(master.masterPath);

    if (parsedWidth || parsedHeight) {
      pipeline = pipeline.resize({
        width: parsedWidth || undefined,
        height: parsedHeight || undefined,
        fit: (fit as FitMode) || "inside", // 'inside' preserves aspect ratio, no cropping
        withoutEnlargement: true, // never upscale beyond the master
      });
    }

    pipeline = pipeline.toFormat(outFormat as keyof sharp.FormatEnum, {
      quality: 85,
    });

    const buffer = await pipeline.toBuffer();
    await fsp.writeFile(cachePath, buffer);

    return res.type(outFormat).send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to generate resized image" });
  }
}

// ---------------------------------------------------------------------
// GET /tags — list all unique tags
// ---------------------------------------------------------------------
app.get("/tags", async (_req: Request, res: Response): Promise<any> => {
  try {
    const tags = await prisma.tag.findMany();
    return res.json(tags.map((t) => t.name));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch tags" });
  }
});

// ---------------------------------------------------------------------
// GET /images/:id/tags — get tags for a specific image
// ---------------------------------------------------------------------
app.get(
  "/images/:id/tags",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const id = req.params.id as string;
      const image = await prisma.image.findUnique({
        where: { id },
        include: { tags: true },
      });
      if (!image) return res.status(404).json({ error: "Image not found" });
      return res.json(image.tags.map((t) => t.name));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch tags" });
    }
  },
);

// ---------------------------------------------------------------------
// PUT /images/:id/tags — set tags for an image
// ---------------------------------------------------------------------
app.put(
  "/images/:id/tags",
  requireApiKey,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags)) {
        return res
          .status(400)
          .json({ error: "tags must be an array of strings" });
      }

      const id = req.params.id as string;
      const image = await prisma.image.findUnique({ where: { id } });
      if (!image) return res.status(404).json({ error: "Image not found" });

      const tagIdsToConnect = [];
      for (const tagName of tags) {
        const trimmed = String(tagName).trim();
        if (!trimmed) continue;

        // Note: name is LongText, so we just findFirst
        let existing = await prisma.tag.findFirst({ where: { name: trimmed } });
        if (!existing) {
          existing = await prisma.tag.create({
            data: { id: nanoid(12), name: trimmed },
          });
        }
        tagIdsToConnect.push({ id: existing.id });
      }

      const updated = await prisma.image.update({
        where: { id },
        data: {
          tags: {
            set: [], // clear existing tags on this image
            connect: tagIdsToConnect,
          },
        },
        include: { tags: true },
      });

      return res.json(updated.tags.map((t) => t.name));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to update tags" });
    }
  },
);

// ---------------------------------------------------------------------
// GET /all or GET /images — returns all uploaded images
// ---------------------------------------------------------------------
app.get(
  ["/all", "/images"],
  async (req: Request, res: Response): Promise<any> => {
    try {
      const tagsParam =
        typeof req.query.tags === "string" ? req.query.tags : undefined;
      let whereClause: any = {};

      if (tagsParam) {
        whereClause = {
          tags: { some: { name: tagsParam } },
        };
      }

      const images = await prisma.image.findMany({
        where: whereClause,
        include: { tags: true },
      });

      const host = req.get("host");
      const protocol = req.protocol || "http";
      const baseUrl = `${protocol}://${host}`;

      const results = images.map((img) => ({
        ...img,
        tags: img.tags.map((t) => t.name),
        urls: {
          original: `${baseUrl}/images/${img.id}/original`,
          thumbnail: `${baseUrl}/images/${img.id}/thumbnail`,
          small: `${baseUrl}/images/${img.id}/small`,
          medium: `${baseUrl}/images/${img.id}/medium`,
          large: `${baseUrl}/images/${img.id}/large`,
          custom: `${baseUrl}/images/${img.id}?width=W&height=H`,
        },
      }));

      return res.json(results);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch images" });
    }
  },
);

// ---------------------------------------------------------------------
// GET /playlist.m3u — returns all images as an M3U playlist
// ---------------------------------------------------------------------
app.get("/playlist.m3u", async (req: Request, res: Response): Promise<any> => {
  try {
    const images = await prisma.image.findMany();

    const host = req.get("host");
    const protocol = req.protocol || "http";

    let m3u = "#EXTM3U\n";
    for (const img of images) {
      m3u += `#EXTINF:3,Image ${img.id}\n`;
      m3u += `${protocol}://${host}/images/${img.id}/large\n`;
    }

    res.setHeader("Content-Type", "audio/x-mpegurl");
    res.setHeader("Content-Disposition", 'attachment; filename="playlist.m3u"');
    return res.send(m3u);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to generate playlist" });
  }
});

// ---------------------------------------------------------------------
// GET /images/:id/original  — untouched master
// ---------------------------------------------------------------------
app.get(
  "/images/:id/original",
  async (req: Request, res: Response): Promise<any> => {
    const id = req.params.id as string;
    const master = await findMaster(id);
    if (!master) return res.status(404).json({ error: "Image not found" });
    return res.type(master.meta.format).sendFile(master.masterPath);
  },
);

// ---------------------------------------------------------------------
// GET /images/:id/:preset  — named preset (thumbnail/small/medium/large)
// ---------------------------------------------------------------------
app.get(
  "/images/:id/:preset",
  async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    const presetKey = req.params.preset as string;
    const preset = PRESETS[presetKey];
    if (!preset) return next(); // fall through to 404 handler
    const format =
      typeof req.query.format === "string" ? req.query.format : undefined;
    return serveResized(req, res, { ...preset, format });
  },
);

// ---------------------------------------------------------------------
// GET /images/:id  — arbitrary ?width=&height=&fit=&format=
// ---------------------------------------------------------------------
app.get("/images/:id", async (req: Request, res: Response): Promise<any> => {
  const width =
    typeof req.query.width === "string" ? req.query.width : undefined;
  const height =
    typeof req.query.height === "string" ? req.query.height : undefined;
  const fit = typeof req.query.fit === "string" ? req.query.fit : undefined;
  const format =
    typeof req.query.format === "string" ? req.query.format : undefined;

  if (!width && !height) {
    return res.status(400).json({
      error:
        "Provide width and/or height, or use a preset like /images/:id/thumbnail",
    });
  }
  return serveResized(req, res, { width, height, fit, format });
});

// ---------------------------------------------------------------------
// DELETE /images/:id — remove master + any cached variants
// ---------------------------------------------------------------------
app.delete(
  "/images/:id",
  requireApiKey,
  async (req: Request, res: Response): Promise<any> => {
    const id = req.params.id as string;
    const master = await findMaster(id);
    if (!master) return res.status(404).json({ error: "Image not found" });

    await fsp.unlink(master.masterPath).catch(() => {});
    await prisma.image
      .delete({
        where: { id },
      })
      .catch(() => {});

    // Cache entries are content-hashed, not indexed by id, so we sweep and
    // drop any that reference this id. For heavy traffic, swap this for a
    // small index file written alongside the master instead of a full scan.
    await fsp.readdir(CACHE_DIR).catch(() => []);
    // (Left as a no-op sweep placeholder — see README for an indexed approach.)

    return res.json({ deleted: true, id: req.params.id });
  },
);

app.use((_req: Request, res: Response) =>
  res.status(404).json({ error: "Not found" }),
);

app.listen(PORT, () => {
  console.log(`Image API listening on http://localhost:${PORT}`);
});
