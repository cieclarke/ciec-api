import express from 'express';
import vhost from 'vhost';
import * as api from './index';
import cors from 'cors';

const app = express();
const apiApp = express();
const wwwApp = express();
apiApp.use(cors());

if (!process.env.web_app_base_dir) throw new Error();

wwwApp.use(express.static(process.env.web_app_base_dir));

apiApp.get('/albums', async (req, res) => {
  res.send(await api.flickr.getAlbums());
});

apiApp.get('/photos/', async (req, res) => {
  res.send(await api.flickr.getAllPhotos());
});

apiApp.get('/img/:album/:photo', async (req, res) => {
  res.send({});
});

const PORT = process.env.PORT || 8080;

app.use(vhost(process.env.api_hostname || '', apiApp));
app.use(vhost(process.env.www_hostname || '', wwwApp));

app.listen(PORT);
