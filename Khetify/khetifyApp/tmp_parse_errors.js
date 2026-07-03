import fs from 'fs';
import parser from '@babel/parser';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
try {
  parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator'], errorRecovery: true });
  console.log('parsed OK');
} catch (e) {
  console.error('parse failed', e.message);
  if (e.loc) console.error('line', e.loc.line, 'column', e.loc.column);
  if (e.codeFrame) console.error(e.codeFrame);
  if (e.recoverableErrors) {
    console.log('recoverable errors:', e.recoverableErrors.map(err => `${err.message} at ${err.loc.line}:${err.loc.column}`));
  }
}
