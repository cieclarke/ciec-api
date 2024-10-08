import express from 'express';

const wwwApp = express();
if (!process.env.web_app_base_dir) throw new Error();
wwwApp.use(express.static(process.env.web_app_base_dir));

export default wwwApp;
