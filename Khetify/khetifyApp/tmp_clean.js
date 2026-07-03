import fs from 'fs';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
const stripped = code
  .replace(/\/\*[^]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '')
  .replace(/'(?:\\[\s\S]|[^'\\])*'/g, '')
  .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '');
let braces = 0, parens = 0, brackets = 0;
const lines = stripped.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const ch of line) {
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
  }
  if (i >= 300 && i <= 451) console.log(`${i+1}: braces=${braces} parens=${parens} brackets=${brackets} | ${line}`);
}
console.log('final', { braces, parens, brackets });
