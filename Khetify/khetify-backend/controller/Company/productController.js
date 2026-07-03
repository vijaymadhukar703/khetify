const Product = require("../../model/Company/productModel");
const Company = require("../../model/Company/Company");
const mongoose = require("mongoose");
const inventoryService = require("../../services/inventoryService"); // ← NEW

/* ================= CREATE PRODUCT ================= */
exports.createProduct = async (req, res) => {
  try {
    const { companyId, variantType } = req.body;

    // ================= COMPANY CHECK =================
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // ================= IMAGE HANDLE =================
    if (req.files && req.files.length > 0) {
      // Store a URL-safe relative path. file.path is an absolute filesystem path
      // (with backslashes on Windows) which breaks every downstream URL builder.
      // file.filename is the disk filename; the multer middleware places it in
      // uploads/products/, served by `app.use("/uploads", ...)`.
      req.body.productImages = req.files.map((file) => `uploads/products/${file.filename}`);
    }

    // ================= VARIANT HANDLE =================
    if (req.body.variants && typeof req.body.variants === "string") {
      req.body.variants = JSON.parse(req.body.variants);
    }
    // Bulk packaging may arrive as a JSON string from multipart form-data.
    if (req.body.bulkPackaging && typeof req.body.bulkPackaging === "string") {
      try { req.body.bulkPackaging = JSON.parse(req.body.bulkPackaging); } catch { /* ignore malformed */ }
    }
    if (variantType === "single") {
      req.body.variants = [];
    }
    if (variantType === "multiple") {
      req.body.price = undefined;
      req.body.length = undefined;
      req.body.width = undefined;
      req.body.height = undefined;
      req.body.weight = undefined;
    }

    // ================= CREATE PRODUCT =================
    const newProduct = new Product(req.body);
    await newProduct.save();

    // ================= NEW: SEED INVENTORY (IMS) =================
    // Create the company-owned inventory row so the marketplace has a
    // single source of truth for this product's stock from day one.
    try {
      const initialStock = Number(req.body.availableStock) || 0;
      const inv = await inventoryService.ensureInventory({
        productId: newProduct._id,
        ownerType: "company",
        ownerId: companyId,
        lowStockThreshold: Number(req.body.lowStockThreshold) || 0,
      });
      if (initialStock > 0) {
        await inventoryService.adjust({
          productId: newProduct._id,
          ownerType: "company",
          ownerId: companyId,
          delta: initialStock,
          channel: "online",
          note: "initial stock on product create",
          performedBy: companyId,
        });
      }
      void inv;
    } catch (invErr) {
      // Don't fail product creation if inventory seeding hiccups; just log it.
      console.error("Inventory seed warning:", invErr.message);
    }

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: newProduct,
    });
  } catch (error) {
    console.error("Create Product Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

/* ================= GET SINGLE PRODUCT ================= */
exports.getSingleProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId).populate(
      "companyId",
      "companyInfo.companyName businessContact.businessEmail"
    );
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error("Get Single Product Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ================= GET ALL PRODUCTS ================= */
exports.getAllProducts = async (req, res) => {
  try {
    const { search, category } = req.query;
    // Always scope to the authenticated company (server-derived) — never trust
    // a client-supplied companyId (multi-tenancy invariant #1).
    const filter = { companyId: req.user.companyId };
    if (search && search.trim() !== "") {
      filter.productName = { $regex: search.trim(), $options: "i" };
    }
    if (category && category !== "undefined") {
      filter.category = category;
    }
    const products = await Product.find(filter)
      .populate("companyId", "companyInfo.companyName fullName")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: products.length, data: products });
  } catch (error) {
    console.error("Get All Products Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= UPDATE PRODUCT ================= */
exports.updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    // The edit form loads the product with companyId POPULATED (an object), so
    // multipart form-data stringifies it to the literal "[object Object]".
    // Validate only a real ObjectId; anything else is dropped so the product
    // keeps its existing company (a product's owner never changes on edit).
    // Without this, Company.findById("[object Object]") throws a CastError on
    // path _id ("Invalid value for _id: [object Object]").
    if (req.body.companyId && mongoose.Types.ObjectId.isValid(req.body.companyId)) {
      const company = await Company.findById(req.body.companyId);
      if (!company) {
        return res.status(404).json({ success: false, message: "Company not found" });
      }
    } else {
      delete req.body.companyId;
    }
    const existingProduct = await Product.findById(productId);
    if (!existingProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // Multipart form-data sends every field as a string, including "" for blanks.
    // Mongoose Number/Date casts fail on "" → NaN/Invalid Date → 500 on validate.
    // Coerce empty strings to undefined so the existing value (or schema default)
    // is preserved; coerce numeric strings to numbers; coerce ISO date strings
    // to Date objects.
    const NUMBER_FIELDS = [
      "mrp", "costPrice", "gstPercentage",
      "price", "length", "width", "height", "weight",
      "availableStock", "minimumOrderQuantity", "monthlyProductionCapacity",
    ];
    const DATE_FIELDS = ["manufacturingDate", "expiryDate"];

    for (const k of NUMBER_FIELDS) {
      if (k in req.body) {
        const v = req.body[k];
        if (v === "" || v === null) {
          delete req.body[k];          // leave the existing value untouched
        } else if (typeof v === "string") {
          const n = Number(v);
          if (Number.isFinite(n)) req.body[k] = n;
          else delete req.body[k];     // garbage → ignore rather than 500
        }
      }
    }
    for (const k of DATE_FIELDS) {
      if (k in req.body) {
        const v = req.body[k];
        if (v === "" || v === null) {
          delete req.body[k];
        } else if (typeof v === "string") {
          const d = new Date(v);
          if (!isNaN(d.getTime())) req.body[k] = d;
          else delete req.body[k];
        }
      }
    }

    // Defensive: never let req.body overwrite the immutable identity fields.
    delete req.body._id;
    delete req.body.createdAt;
    delete req.body.updatedAt;

    // ================= IMAGE HANDLE =================
    // The edit form is the single source of truth for the image set: it sends
    // the FULL list of existing images the user KEPT as `kept_images` (relative
    // paths), and appends any newly uploaded files separately. So the resulting
    // productImages = kept_images + new uploads. Removed images simply aren't in
    // kept_images, so they drop off. (The previous code read `removedImages`,
    // which the client never sends — that's why removed images persisted.)
    //
    // multer `.array("productImages")` puts text fields in req.body: a string
    // when one image is kept, an array when several, and undefined when none.
    let keptImages = req.body.kept_images;
    if (keptImages === undefined) keptImages = [];
    else if (!Array.isArray(keptImages)) keptImages = [keptImages];
    // Normalize each kept path to the clean "uploads/..." tail (tolerates legacy
    // absolute paths / backslashes that may have leaked into older records).
    let currentImages = keptImages
      .filter((p) => p != null && String(p).trim() !== "")
      .map((p) => {
        const s = String(p).replace(/\\/g, "/");
        const i = s.toLowerCase().indexOf("uploads/");
        return i >= 0 ? s.slice(i) : s;
      });

    if (req.files && req.files.length > 0) {
      // Keep S3 `location` if present, else the clean relative
      // "uploads/products/<filename>" path (never the absolute Windows
      // file.path, which breaks downstream URL builders).
      const newImages = req.files.map((file) => file.location || `uploads/products/${file.filename}`);
      currentImages = [...currentImages, ...newImages];
    }
    req.body.productImages = currentImages;
    delete req.body.kept_images;
    delete req.body.removedImages;

    // ================= VARIANT HANDLE =================
    const { variantType } = req.body;
    // variants/bulkPackaging may arrive as a JSON string (good) OR — when the
    // form re-sends a live JS array/object — as multipart's "[object Object]"
    // junk. Parse what we can; if it's unparseable, DROP it so the existing
    // value is preserved instead of clobbering the field or throwing.
    if (req.body.variants && typeof req.body.variants === "string") {
      try { req.body.variants = JSON.parse(req.body.variants); }
      catch { delete req.body.variants; }
    }
    if (req.body.bulkPackaging && typeof req.body.bulkPackaging === "string") {
      try { req.body.bulkPackaging = JSON.parse(req.body.bulkPackaging); }
      catch { delete req.body.bulkPackaging; }
    }

    // Strip subdocument _id fields. The frontend re-submits the existing product
    // (including variants[]._id) when editing; depending on serialization, those
    // _id values may arrive as JS objects (e.g. { $oid: "..." } from extended
    // JSON) which mongoose CANNOT cast to ObjectId, producing
    // "Invalid value for _id: [object Object]" on save. Stripping is safe — no
    // other entity in this codebase references a variant's or bulkPackaging's _id.
    if (Array.isArray(req.body.variants)) {
      req.body.variants = req.body.variants.map((v) => {
        if (v && typeof v === "object") {
          // Keep _id only if it's a valid 24-char hex string.
          if (v._id != null) {
            const s = String(v._id);
            if (!/^[0-9a-f]{24}$/i.test(s)) delete v._id;
            else v._id = s;
          }
        }
        return v;
      });
    }
    if (req.body.bulkPackaging && typeof req.body.bulkPackaging === "object") {
      if (req.body.bulkPackaging._id != null) {
        const s = String(req.body.bulkPackaging._id);
        if (!/^[0-9a-f]{24}$/i.test(s)) delete req.body.bulkPackaging._id;
        else req.body.bulkPackaging._id = s;
      }
    }

    if (variantType === "single") {
      req.body.variants = [];
    }
    if (variantType === "multiple") {
      req.body.price = undefined;
      req.body.length = undefined;
      req.body.width = undefined;
      req.body.height = undefined;
      req.body.weight = undefined;
    }

    const updatedProduct = await Product.findByIdAndUpdate(productId, req.body, {
      new: true,
      runValidators: true,
    });
    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Update Product Error:", error);
    // Mongoose validation errors carry per-field detail — surface them.
    if (error?.name === "ValidationError") {
      const fields = Object.keys(error.errors || {});
      const detail = fields.map((f) => `${f}: ${error.errors[f].message}`).join(" · ");
      return res.status(400).json({
        success: false,
        message: detail || "Validation failed",
        fields,
      });
    }
    if (error?.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: `Invalid value for ${error.path}: ${error.value}`,
      });
    }
    res.status(500).json({
      success: false,
      message: error?.message || "Server Error",
    });
  }
};

/* ================= DELETE PRODUCT ================= */
exports.deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    const deletedProduct = await Product.findByIdAndDelete(productId);
    if (!deletedProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
      data: deletedProduct,
    });
  } catch (error) {
    console.error("Delete Product Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
