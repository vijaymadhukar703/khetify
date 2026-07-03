import fs from 'fs';
import parser from '@babel/parser';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
const lines = code.split(/\r?\n/);
for (let end = 100; end <= lines.length; end += 50) {
  const chunk = lines.slice(0, end).join('\n');
  try {
    parser.parse(chunk, { sourceType: 'module', plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator'] });
    console.log(`OK through line ${end}`);
  } catch (e) {
    console.error(`FAIL at line ${end}: ${e.message}`);
    if (e.loc) console.error('loc', e.loc.line, e.loc.column);
    break;
  }
}
