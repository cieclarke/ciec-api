# Image Hosting API

Serves multiple sizes of an image generated on-the-fly from a single stored
"master" copy, using [sharp](https://sharp.pixelplumbing.com/) for resizing.
Resized variants are cached to disk after first generation.

## Setup

```bash
npm install
docker-compose up -d # start the MySQL database in the background
npx prisma db push   # push schema to your MySQL database
npm run build        # compile TypeScript to dist/
npm start            # run compiled server (or: npm run dev for hot-reloading with tsx)
```

Server listens on `http://localhost:3000` by default (set `PORT` to change it).

## How it works

- **`/originals`** — untouched master images, one file per upload. Metadata
  (dimensions, format, upload time) is persisted to MySQL via Prisma.
- **`/cache`** — resized variants, named by a hash of `(id, width, height,
fit, format)`. First request for a given size generates and saves it;
  every request after that is served straight from disk.
- Resizing never upscales past the master's original dimensions
  (`withoutEnlargement: true`), and width/height are capped at 4000px to
  prevent abuse via huge query params.

## Endpoints

### Upload a master image

```
POST /images
Content-Type: multipart/form-data
Field name: image
```

Response:

```json
{
  "id": "V1StGXR8_Z5j",
  "width": 3000,
  "height": 2000,
  "format": "jpeg",
  "urls": {
    "original": "/images/V1StGXR8_Z5j/original",
    "thumbnail": "/images/V1StGXR8_Z5j/thumbnail",
    "small": "/images/V1StGXR8_Z5j/small",
    "medium": "/images/V1StGXR8_Z5j/medium",
    "large": "/images/V1StGXR8_Z5j/large",
    "custom": "/images/V1StGXR8_Z5j?width=W&height=H"
  }
}
```

Example with curl:

```bash
curl -F "image=@photo.jpg" http://localhost:3000/images
```

### Get a preset size

```
GET /images/:id/thumbnail   -> 150x150, cropped to fill
GET /images/:id/small       -> fits within 400x400, aspect preserved
GET /images/:id/medium      -> fits within 800x800
GET /images/:id/large       -> fits within 1600x1600
GET /images/:id/original    -> untouched master
```

Presets are defined in `PRESETS` in `server.ts` — add or edit as needed.

### Get a custom size

```
GET /images/:id?width=500
GET /images/:id?width=500&height=300&fit=cover
GET /images/:id?width=500&format=webp
```

`fit` follows sharp's resize modes: `cover` (crop to fill), `contain`,
`fill` (stretch), `inside` (default — fit within bounds, no crop), `outside`.

### Delete an image

```
DELETE /images/:id
```

Removes the master. Note: cached variants are content-hashed rather than
indexed by id, so the current delete handler doesn't sweep them — see
"Possible improvements" below.

## Possible improvements for production use

- **CDN in front of it**: put CloudFront/Cloudflare in front of `/images/*`
  and set long `Cache-Control` headers — sharp only needs to run once per
  variant per server anyway.
- **Object storage**: swap `/originals` and `/cache` for S3 (or similar) so
  the API is stateless and horizontally scalable.
- **Cache index per id**: store `{id: [cacheKey, ...]}` so `DELETE` can
  clean up all variants instead of leaving orphaned cache files.
- **Auth**: add an API key or signed upload URL for the `POST /images`
  route if this won't be publicly writable.
- **Rate limiting**: `express-rate-limit` on the upload route in particular.
- **Signed/expiring URLs**: if images are private, sign the `:id` or issue
  short-lived tokens rather than serving by predictable id.
