import { error } from 'console';
import fetch from 'node-fetch';

interface FlickrAlbumsAPIResponse {
  photosets: {
    page: number;
    pages: number;
    perpage: number;
    total: number;
    photoset: {
      id: string;
      owner: string;
      username: string;
      primary: string;
      secret: string;
      server: string;
      farm: 2;
      count_views: string;
      count_comments: string;
      count_photos: number;
      count_videos: number;
      title: {
        _content: string;
      };
      description: {
        _content: '';
      };
      can_comment: number;
      date_create: string;
      date_update: string;
      photos: number;
      videos: number;
      visibility_can_see_set: 1;
      needs_interstitial: number;
      primary_photo_extras: {
        url_m: string;
        height_m: number;
        width_m: number;
      };
    }[];
  };
  stat: string;
}

interface FlickrPhotosAPIResponse {
  photoset: {
    id: string;
    photo: {
      id: string;
      title: string;
      url_m: string;
      url_s: string;
      url_sq: string;
      url_t: string;
    }[];
  };
}

export interface Album {
  id: string;
  url: string;
}

export interface Photo {
  id: string;
  url: string;
}

export const getAlbums = async (): Promise<Album[]> => {
  const res = await get<FlickrAlbumsAPIResponse>('flickr.photosets.getList', {
    primary_photo_extras: 'url_m',
    per_page: 10,
    format: 'json',
    nojsoncallback: 1,
  });
  return mapResToAlbum(res);
};

export const getAllPhotos = async (): Promise<Photo[]> => {
  const albums = await getAlbums();
  const photos = await Promise.all(albums.map((a) => getPhotos(a.id)));
  return photos.flat();
};

export const getPhotos = async (albumId: string): Promise<Photo[]> => {
  const res = await get<FlickrPhotosAPIResponse>('flickr.photosets.getPhotos', {
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

const flickrAPIKeys = (): { [key: string]: string } => {
  if (process.env.flickr_user_id && process.env.flickr_api_key) {
    return {
      user_id: process.env.flickr_user_id,
      api_key: process.env.flickr_api_key,
    };
  }

  throw new Error('env vars undefined');
};

const mapResToAlbum = (res: FlickrAlbumsAPIResponse): Album[] =>
  res.photosets.photoset.map((p) => ({
    id: p.id,
    url: p.primary_photo_extras.url_m,
  }));

const get = async <T>(
  flickrMethod: string,
  options: { [key: string]: string | number },
) => {
  const keys = flickrAPIKeys() || {};
  const c = [...Object.entries(options), ...Object.entries(keys)];
  const params = c.reduce((prev, [key, value]) => {
    return `${prev}&${key}=${value}`;
  }, `method=${flickrMethod}`);

  const res = await fetch(`https://api.flickr.com/services/rest?${params}`);
  return <Promise<T>>res.json();
};
