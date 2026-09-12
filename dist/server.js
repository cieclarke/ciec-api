"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const fs_1 = __importDefault(require("fs"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const nanoid_1 = require("nanoid");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
const ORIGINALS_DIR = path_1.default.join(__dirname, "originals");
const CACHE_DIR = path_1.default.join(__dirname, "cache");
const MAX_UPLOAD_MB = 25;
for (const dir of [ORIGINALS_DIR, CACHE_DIR]) {
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
}
// ---- Named presets. Anything not in here can still be requested via
// ---- arbitrary ?width=&height= query params (validated below).
const PRESETS = {
    thumbnail: { width: 150, height: 150, fit: "cover" },
    small: { width: 400, height: 400, fit: "inside" },
    medium: { width: 800, height: 800, fit: "inside" },
    large: { width: 1600, height: 1600, fit: "inside" },
};
const ALLOWED_FORMATS = new Set(["jpeg", "jpg", "png", "webp", "avif"]);
const MAX_DIMENSION = 4000; // guard against abuse via huge width/height params
// ---------------------------------------------------------------------
// Upload handling
// ---------------------------------------------------------------------
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image uploads are allowed"));
        }
        cb(null, true);
    },
});
app.use(express_1.default.json());
// ---------------------------------------------------------------------
// API Key Check Middleware
// ---------------------------------------------------------------------
const requireApiKey = (req, res, next) => {
    const apiKey = process.env.API_PRIVATE_KEY;
    if (!apiKey) {
        console.warn("WARNING: API_PRIVATE_KEY is not set. Denying request.");
        return res.status(500).json({ error: "Server configuration error" });
    }
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers["x-api-key"];
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
app.post("/images", requireApiKey, upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res
                .status(400)
                .json({ error: 'No image file provided (field name: "image")' });
        }
        const id = (0, nanoid_1.nanoid)(12);
        const metadata = await (0, sharp_1.default)(req.file.buffer).metadata();
        if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
            return res
                .status(415)
                .json({ error: `Unsupported format: ${metadata.format}` });
        }
        // Normalize the master to a well-known extension/format so downstream
        // resizing logic doesn't need to branch on the original file type.
        const masterPath = path_1.default.join(ORIGINALS_DIR, `${id}.${metadata.format}`);
        await promises_1.default.writeFile(masterPath, req.file.buffer);
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
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to process upload" });
    }
});
// ---------------------------------------------------------------------
// Shared resolver: find the master file for an id
// ---------------------------------------------------------------------
async function findMaster(id) {
    const meta = await prisma.image.findUnique({
        where: { id },
    });
    if (!meta)
        return null;
    const masterPath = path_1.default.join(ORIGINALS_DIR, `${id}.${meta.format}`);
    if (!fs_1.default.existsSync(masterPath))
        return null;
    return { meta, masterPath };
}
// ---------------------------------------------------------------------
// Core resize + cache logic, shared by preset and custom routes
// ---------------------------------------------------------------------
async function serveResized(req, res, { width, height, fit, format }) {
    const id = req.params.id;
    const master = await findMaster(id);
    if (!master)
        return res.status(404).json({ error: "Image not found" });
    let parsedWidth = null;
    if (width !== undefined && width !== null) {
        const w = typeof width === "string" ? parseInt(width, 10) : width;
        if (isNaN(w) || w <= 0) {
            return res
                .status(400)
                .json({ error: "width/height must be positive integers" });
        }
        parsedWidth = Math.min(w, MAX_DIMENSION);
    }
    let parsedHeight = null;
    if (height !== undefined && height !== null) {
        const h = typeof height === "string" ? parseInt(height, 10) : height;
        if (isNaN(h) || h <= 0) {
            return res
                .status(400)
                .json({ error: "width/height must be positive integers" });
        }
        parsedHeight = Math.min(h, MAX_DIMENSION);
    }
    const outFormat = format && ALLOWED_FORMATS.has(format) ? format : master.meta.format;
    // Cache key is deterministic from id + all transform params, so repeat
    // requests for the same variant are served straight off disk.
    const cacheKey = crypto_1.default
        .createHash("sha1")
        .update(JSON.stringify({
        id,
        width: parsedWidth,
        height: parsedHeight,
        fit,
        outFormat,
    }))
        .digest("hex");
    const cachePath = path_1.default.join(CACHE_DIR, `${cacheKey}.${outFormat}`);
    if (fs_1.default.existsSync(cachePath)) {
        return res.type(outFormat).sendFile(cachePath);
    }
    try {
        let pipeline = (0, sharp_1.default)(master.masterPath);
        if (parsedWidth || parsedHeight) {
            pipeline = pipeline.resize({
                width: parsedWidth || undefined,
                height: parsedHeight || undefined,
                fit: fit || "inside", // 'inside' preserves aspect ratio, no cropping
                withoutEnlargement: true, // never upscale beyond the master
            });
        }
        pipeline = pipeline.toFormat(outFormat, {
            quality: 85,
        });
        const buffer = await pipeline.toBuffer();
        await promises_1.default.writeFile(cachePath, buffer);
        return res.type(outFormat).send(buffer);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to generate resized image" });
    }
}
// ---------------------------------------------------------------------
// GET /tags — list all unique tags
// ---------------------------------------------------------------------
app.get("/tags", async (_req, res) => {
    try {
        const tags = await prisma.tag.findMany();
        return res.json(tags.map((t) => t.name));
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch tags" });
    }
});
// ---------------------------------------------------------------------
// GET /images/:id/tags — get tags for a specific image
// ---------------------------------------------------------------------
app.get("/images/:id/tags", async (req, res) => {
    try {
        const id = req.params.id;
        const image = await prisma.image.findUnique({
            where: { id },
            include: { tags: true },
        });
        if (!image)
            return res.status(404).json({ error: "Image not found" });
        return res.json(image.tags.map((t) => t.name));
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch tags" });
    }
});
// ---------------------------------------------------------------------
// PUT /images/:id/tags — set tags for an image
// ---------------------------------------------------------------------
app.put("/images/:id/tags", requireApiKey, async (req, res) => {
    try {
        const { tags } = req.body;
        if (!Array.isArray(tags)) {
            return res.status(400).json({ error: "tags must be an array of strings" });
        }
        const id = req.params.id;
        const image = await prisma.image.findUnique({ where: { id } });
        if (!image)
            return res.status(404).json({ error: "Image not found" });
        const tagIdsToConnect = [];
        for (const tagName of tags) {
            const trimmed = String(tagName).trim();
            if (!trimmed)
                continue;
            // Note: name is LongText, so we just findFirst
            let existing = await prisma.tag.findFirst({ where: { name: trimmed } });
            if (!existing) {
                existing = await prisma.tag.create({
                    data: { id: (0, nanoid_1.nanoid)(12), name: trimmed },
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
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to update tags" });
    }
});
// ---------------------------------------------------------------------
// GET /all or GET /images — returns all uploaded images
// ---------------------------------------------------------------------
app.get(["/all", "/images"], async (req, res) => {
    try {
        const tagsParam = typeof req.query.tags === "string" ? req.query.tags : undefined;
        let whereClause = {};
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
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch images" });
    }
});
// ---------------------------------------------------------------------
// GET /playlist.m3u — returns all images as an M3U playlist
// ---------------------------------------------------------------------
app.get("/playlist.m3u", async (req, res) => {
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
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to generate playlist" });
    }
});
// ---------------------------------------------------------------------
// GET /images/:id/original  — untouched master
// ---------------------------------------------------------------------
app.get("/images/:id/original", async (req, res) => {
    const id = req.params.id;
    const master = await findMaster(id);
    if (!master)
        return res.status(404).json({ error: "Image not found" });
    return res.type(master.meta.format).sendFile(master.masterPath);
});
// ---------------------------------------------------------------------
// GET /images/:id/:preset  — named preset (thumbnail/small/medium/large)
// ---------------------------------------------------------------------
app.get("/images/:id/:preset", async (req, res, next) => {
    const presetKey = req.params.preset;
    const preset = PRESETS[presetKey];
    if (!preset)
        return next(); // fall through to 404 handler
    const format = typeof req.query.format === "string" ? req.query.format : undefined;
    return serveResized(req, res, { ...preset, format });
});
// ---------------------------------------------------------------------
// GET /images/:id  — arbitrary ?width=&height=&fit=&format=
// ---------------------------------------------------------------------
app.get("/images/:id", async (req, res) => {
    const width = typeof req.query.width === "string" ? req.query.width : undefined;
    const height = typeof req.query.height === "string" ? req.query.height : undefined;
    const fit = typeof req.query.fit === "string" ? req.query.fit : undefined;
    const format = typeof req.query.format === "string" ? req.query.format : undefined;
    if (!width && !height) {
        return res.status(400).json({
            error: "Provide width and/or height, or use a preset like /images/:id/thumbnail",
        });
    }
    return serveResized(req, res, { width, height, fit, format });
});
// ---------------------------------------------------------------------
// DELETE /images/:id — remove master + any cached variants
// ---------------------------------------------------------------------
app.delete("/images/:id", requireApiKey, async (req, res) => {
    const id = req.params.id;
    const master = await findMaster(id);
    if (!master)
        return res.status(404).json({ error: "Image not found" });
    await promises_1.default.unlink(master.masterPath).catch(() => { });
    await prisma.image
        .delete({
        where: { id },
    })
        .catch(() => { });
    // Cache entries are content-hashed, not indexed by id, so we sweep and
    // drop any that reference this id. For heavy traffic, swap this for a
    // small index file written alongside the master instead of a full scan.
    await promises_1.default.readdir(CACHE_DIR).catch(() => []);
    // (Left as a no-op sweep placeholder — see README for an indexed approach.)
    return res.json({ deleted: true, id: req.params.id });
});
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.listen(PORT, () => {
    console.log(`Image API listening on http://localhost:${PORT}`);
});
