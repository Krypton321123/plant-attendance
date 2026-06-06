import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import routes from './routes';
import "dotenv/config"

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express();
const PORT = process.env.PORT || 8000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(cors({origin: '*'}));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: "4mb" }));

app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)));

app.use('/api', routes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Plant Attendance Server running on http://localhost:${PORT}`);
});