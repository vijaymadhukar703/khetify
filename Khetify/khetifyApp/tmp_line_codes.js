import fs from 'fs';
const lines = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8').split(/\r?\n/);
for (let i = 95; i <= 110; i++) {
  const line = lines[i];
  console.log(`${i+1}: ${JSON.stringify(line)}`);
  console.log(line.split('').map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join(' '));
}
