import fs from 'fs';
const line = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8').split(/\r?\n/)[149];
console.log(JSON.stringify(line));
console.log(line.split('').map(c => c.codePointAt(0).toString(16).padStart(4,'0')).join(' '));
