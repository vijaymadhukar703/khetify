import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getShopProduct } from "../../lib/shopApi";
import { getProductImage } from "../../lib/productImage";
import { useCart } from "../../context/CartContext";
import { rupee } from "../../Components/shop/ProductCard";

export default function ShopProductDetail() {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res = await getShopProduct(listingId);
        if (!alive) return;
        setProduct(res.data);
        setQty(1); // default cart quantity is always 1
      } catch (e) {
        if (alive) setError(e?.response?.data?.message || "Product not found");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [listingId]);

  if (loading) return <div className="py-20 text-center text-stone-400 font-sora">Loading…</div>;
  if (error) return (
    <div className="py-20 text-center font-sora">
      <p className="text-[#EA2831]">{error}</p>
      <Link to="/customer-shop/products" className="text-stone-700 hover:text-[#EA2831] mt-3 inline-block font-medium">← Back to products</Link>
    </div>
  );

  const images = (product.images || []).map(getProductImage).filter(Boolean);
  const off = product.mrp && product.mrp > product.price
    ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;
  const inStock = product.inStock;
  const maxQty = inStock ? product.availableStock : 0;

  const addToCart = () => addItem(product, qty);
  const buyNow = () => { addItem(product, qty); navigate("/customer-shop/cart"); };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-stone-500 hover:text-[#EA2831] mb-4">
        <span className="material-symbols-outlined text-lg">arrow_back</span> Back
      </button>

      <div className="grid md:grid-cols-2 gap-8 bg-white rounded-3xl p-6 border border-stone-200 shadow-sm">
        {/* Gallery */}
        <div>
          <div className="aspect-square bg-stone-50 rounded-2xl border border-stone-100 flex items-center justify-center overflow-hidden">
            {images.length ? (
              <img src={images[activeImg]} alt={product.name} className="w-full h-full object-contain" />
            ) : (
              <span className="material-symbols-outlined text-stone-300 text-7xl font-light">inventory_2</span>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 mt-3">
              {images.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className={`w-16 h-16 rounded-xl overflow-hidden border-2 ${i === activeImg ? "border-[#EA2831]" : "border-stone-200"}`}
                >
                  <img src={src} alt="" className="w-full h-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div>
          {product.category && <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">{product.category}</span>}
          <h1 className="text-2xl font-bold text-stone-900 mt-1">{product.name}</h1>
          {product.sku && <p className="text-xs text-stone-400 font-mono uppercase tracking-tight mt-1">SKU: {product.sku}</p>}

          <div className="mt-2 text-sm text-stone-500 space-y-0.5">
            {product.brand && <p>Brand: <span className="text-stone-700 font-medium">{product.brand}</span></p>}
            {product.seller?.name && (
              <p>Sold by <span className="font-medium text-stone-700">{product.seller.name}</span>
                {product.seller.city ? ` · ${product.seller.city}${product.seller.state ? ", " + product.seller.state : ""}` : ""}
              </p>
            )}
            {product.companyName && <p>Brand owner: <span className="text-stone-700 font-medium">{product.companyName}</span></p>}
          </div>

          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-3xl font-bold text-stone-900">{rupee(product.price)}</span>
            {off > 0 && <span className="text-lg text-stone-400 line-through">{rupee(product.mrp)}</span>}
            {off > 0 && <span className="text-sm font-semibold text-emerald-700">{off}% off</span>}
          </div>
          {product.gstPercentage > 0 && <p className="text-xs text-stone-400 mt-1">+ {product.gstPercentage}% GST at checkout</p>}

          {/* Stock */}
          <div className="mt-3">
            {inStock ? (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-700 font-semibold">
                <span className="material-symbols-outlined text-base">check_circle</span>
                In stock{product.availableStock ? ` · ${product.availableStock} ${product.unit || "units"} available` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-[#EA2831] font-semibold">
                <span className="material-symbols-outlined text-base">block</span> Out of stock
              </span>
            )}
          </div>

          {product.description && (
            <div className="mt-5">
              <h3 className="font-bold text-stone-800 text-sm mb-1">Description</h3>
              <p className="text-sm text-stone-600 whitespace-pre-line">{product.description}</p>
            </div>
          )}

          {/* Qty + actions */}
          {inStock && (
            <div className="mt-6 flex items-center gap-3">
              <div className="flex items-center border border-stone-200 rounded-lg">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-2 text-lg text-stone-600 hover:bg-stone-50">−</button>
                <span className="px-4 py-2 text-stone-800 min-w-[3rem] text-center">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} className="px-3 py-2 text-lg text-stone-600 hover:bg-stone-50">+</button>
              </div>
              <span className="text-xs text-stone-400">{maxQty} available</span>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <button onClick={addToCart} disabled={!inStock} className="flex-1 py-3 rounded-lg border-2 border-[#EA2831] text-[#EA2831] font-semibold hover:bg-red-50 disabled:border-stone-200 disabled:text-stone-400 disabled:hover:bg-transparent disabled:cursor-not-allowed">Add to Cart</button>
            <button onClick={buyNow} disabled={!inStock} className="flex-1 py-3 rounded-lg bg-[#EA2831] text-white font-semibold hover:bg-[#d21f27] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed">Buy Now</button>
          </div>
        </div>
      </div>
    </div>
  );
}
