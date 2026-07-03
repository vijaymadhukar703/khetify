const multer = require("multer");
const path = require("path");

// Memory storage so handlers get a Buffer to push straight to S3/storage.
// Accepts PDFs and common image types (KYC scans / signed agreements).
const ALLOWED = /pdf|jpeg|jpg|png|webp/;

const uploadDocuments = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = ALLOWED.test(path.extname(file.originalname).toLowerCase());
    const mime = ALLOWED.test(file.mimetype);
    if (ext || mime) return cb(null, true);
    cb(new Error("Only PDF or image files are allowed"));
  },
});

module.exports = uploadDocuments;
