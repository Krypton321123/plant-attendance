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
ensureDir(path.join(UPLOADS_DIR, 'visitors'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'attendance';
    if (req.path.includes('register')) {
      folder = 'profiles';
    } else if (req.path.includes('gate')) {
      folder = 'visitors';
    }
    const dir = path.join(UPLOADS_DIR, folder);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const timestamp = Date.now();

    // Gate uploads have no empId — visitors aren't employees. Key the
    // filename off the visitor's name instead, same sanitize+fallback shape
    // as the empId branch below. NOTE: this only works if the client puts
    // the "name" text field before the "photo" file field in its FormData —
    // multer parses the multipart stream in order, so req.body isn't fully
    // populated yet when destination/filename fire if the file comes first.
    const isGateUpload = req.path.includes('gate');
    const rawKey = isGateUpload
      ? (req.body?.name || 'visitor')
      : (req.body?.empId || 'unknown');

    const key = String(rawKey).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${key}_${timestamp}${ext}`);
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