import express from 'express';
import * as api from './index';
import cors from 'cors';

const app = express();
app.use(cors());

app.get('/albums', async (req, res) => {
  const albums = await api.flickr.getAlbums();
  res.send(albums);
});

app.get('/photos/', async (req, res) => {
  res.send(await api.flickr.getAllPhotos());
});

app.get('/img/:album/:photo', async (req, res) => {});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {});
