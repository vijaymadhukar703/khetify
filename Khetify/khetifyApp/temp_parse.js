const fs = require('fs');
const parser = require('@babel/parser');
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx', 'utf8');
try {
  parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  console.log('ok');
} catch (e) {
  console.error(e.message);
  if (e.loc) console.error('line', e.loc.line, 'column', e.loc.column);
  process.exit(1);
}
