import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

// Ensure upload directories exist
const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(path.join(UPLOADS_DIR, 'profiles'));
ensureDir(path.join(UPLOADS_DIR, 'attendance'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.path.includes('register') ? 'profiles' : 'attendance';
    const dir = path.join(UPLOADS_DIR, folder);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const timestamp = Date.now();
    const empId = (req.body?.empId || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${empId}_${timestamp}${ext}`);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});