import express from 'express';
import * as flickr from './flickr';
import cors from 'cors';

const apiApp = express();
apiApp.use(cors());

apiApp.get('/albums', async (req, res) => {
  res.send(await flickr.getAlbums());
});

apiApp.get('/photos/', async (req, res) => {
  res.send(await flickr.getAllPhotos());
});

apiApp.get('/img/:album/:photo', async (req, res) => {
  res.send({});
});

export default apiApp;
