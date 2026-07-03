import fs from 'fs';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
const lines = code.split(/\r?\n/);
const start = lines.findIndex(l => l.trim() === 'return (');
const end = lines.findIndex((l, idx) => idx > start && l.trim() === ');');
console.log('start', start+1, 'end', end+1);
console.log(lines.slice(start, end+1).join('\n'));