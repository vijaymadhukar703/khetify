const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 📁 Storage Config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../uploads/products");

    // 🔥 Create folder automatically if not exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueName + path.extname(file.originalname));
  },
});

// 🛑 File Filter
// KYC document fields accept PDF or images (scans / signed certificates);
// every other field (logos, cover images, product/certification images)
// stays image-only.
const DOC_FIELDS = new Set([
  "gstCertificate",
  "registrationCertificate",
  "panCard",
]);

const fileFilter = (req, file, cb) => {
  const allowedTypes = DOC_FIELDS.has(file.fieldname)
    ? /pdf|jpeg|jpg|png|webp/
    : /jpeg|jpg|png|webp/;

  const extName = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );

  const mimeType = allowedTypes.test(file.mimetype);

  if (extName && mimeType) {
    cb(null, true);
  } else {
    cb(
      new Error(
        DOC_FIELDS.has(file.fieldname)
          ? "Only PDF or image files are allowed!"
          : "Only images are allowed!",
      ),
    );
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — roomy enough for scanned PDF certificates
  fileFilter,
});

module.exports = upload;
