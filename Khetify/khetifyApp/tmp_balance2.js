import fs from 'fs';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
const lines = code.split(/\r?\n/);
let braces = 0, parens = 0, brackets = 0;
let inString = null, escaped = false, inLine = false, inBlock = false;
for (let li = 0; li < lines.length; li++) {
  const line = lines[li];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i+1];
    if (inLine) continue;
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === inString) { inString = null; continue; }
      continue;
    }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
  }
  inLine = false;
  if (li >= 300 && li <= 451) {
    if (li < 310 || li > 450 || braces !== 1 || parens !== 1 || brackets !== 0) {
      console.log(`${li+1}: braces=${braces} parens=${parens} brackets=${brackets} | ${line}`);
    }
  }
}
console.log('final', { braces, parens, brackets });
