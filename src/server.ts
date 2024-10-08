import express from 'express';
import vhost from 'vhost';
import wwwapp from './www-app';
import apiapp from './api-app';

const app = express();

const PORT = process.env.PORT || 8080;

app.use(vhost(process.env.api_hostname || '', apiapp));
app.use(vhost(process.env.www_hostname || '', wwwapp));

app.listen(PORT);
