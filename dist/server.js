"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const vhost_1 = __importDefault(require("vhost"));
const api = __importStar(require("./index"));
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
const apiApp = (0, express_1.default)();
const wwwApp = (0, express_1.default)();
apiApp.use((0, cors_1.default)());
if (!process.env.web_app_base_dir)
    throw new Error();
wwwApp.use(express_1.default.static(process.env.web_app_base_dir));
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
app.use((0, vhost_1.default)(process.env.api_hostname || '', apiApp));
app.use((0, vhost_1.default)(process.env.www_hostname || '', wwwApp));
app.listen(PORT);
//# sourceMappingURL=server.js.map