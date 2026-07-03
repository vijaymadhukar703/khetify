import fs from 'fs';
import parser from '@babel/parser';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
const lines = code.split(/\r?\n/);
const ends = [150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 460];
for (const end of ends) {
  const chunk = lines.slice(0, end).join('\n');
  try {
    parser.parse(chunk, { sourceType: 'module', plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator'] });
    console.log(`OK ${end}`);
  } catch (e) {
    console.log(`FAIL ${end}: ${e.message} at ${e.loc?.line}:${e.loc?.column}`);
  }
}
