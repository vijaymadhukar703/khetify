import fs from 'fs';
import parser from '@babel/parser';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
const tokenizer = parser.tokenizer(code, { sourceType: 'module', plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator'] });
let tok;
let count=0;
const tokens=[];
try {
  while ((tok = tokenizer.getToken()).type.label !== 'eof') {
    tokens.push({ label: tok.type.label, value: tok.value, start: tok.loc.start, end: tok.loc.end });
    count++;
    if (count > 2000) break;
  }
} catch (e) {
  console.error('tokenizer failed', e.message, e.loc?.line, e.loc?.column);
}
console.log('tokens', tokens.slice(-30));
console.log('count', tokens.length);
