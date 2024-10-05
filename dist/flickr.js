"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPhotos = exports.getAllPhotos = exports.getAlbums = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const getAlbums = async () => {
    const res = await get('flickr.photosets.getList', {
        primary_photo_extras: 'url_m',
        per_page: 10,
        format: 'json',
        nojsoncallback: 1,
    });
    return mapResToAlbum(res);
};
exports.getAlbums = getAlbums;
const getAllPhotos = async () => {
    const albums = await (0, exports.getAlbums)();
    const photos = await Promise.all(albums.map((a) => (0, exports.getPhotos)(a.id)));
    return photos.flat();
};
exports.getAllPhotos = getAllPhotos;
const getPhotos = async (albumId) => {
    const res = await get('flickr.photosets.getPhotos', {
        photoset_id: albumId,
        extras: 'url_sq, url_t, url_s, url_m, url_o',
        per_page: 10,
        format: 'json',
        nojsoncallback: 1,
    });
    return res.photoset.photo.map((p) => ({
        id: p.id,
        url: p.url_m,
    }));
};
exports.getPhotos = getPhotos;
const flickrAPIKeys = () => {
    if (process.env.flickr_user_id && process.env.flickr_api_key) {
        return {
            user_id: process.env.flickr_user_id,
            api_key: process.env.flickr_api_key,
        };
    }
    throw new Error('env vars undefined');
};
const mapResToAlbum = (res) => res.photosets.photoset.map((p) => ({
    id: p.id,
    url: p.primary_photo_extras.url_m,
}));
const get = async (flickrMethod, options) => {
    const keys = flickrAPIKeys() || {};
    const c = [...Object.entries(options), ...Object.entries(keys)];
    const params = c.reduce((prev, [key, value]) => {
        return `${prev}&${key}=${value}`;
    }, `method=${flickrMethod}`);
    const res = await (0, node_fetch_1.default)(`https://api.flickr.com/services/rest?${params}`);
    return res.json();
};
//# sourceMappingURL=flickr.js.map