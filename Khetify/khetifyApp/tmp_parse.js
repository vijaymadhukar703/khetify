import fs from 'fs';
import parser from '@babel/parser';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
try {
  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true, tokens: true });
  console.log('parsed OK');
  console.log(ast.tokens.slice(-20).map(t => `${t.type.label}(${t.value||''}) at ${t.loc.start.line}:${t.loc.start.column}`).join('\n'));
} catch (e) {
  console.error('parse failed', e.message);
  if (e.loc) console.error('line', e.loc.line, 'column', e.loc.column);
  if (e.codeFrame) console.error(e.codeFrame);
}
