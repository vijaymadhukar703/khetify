import fs from 'fs';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
const lines = code.split(/\r?\n/);
let braces = 0, parens = 0, brackets = 0;
let inString = null, escaped = false, inLineComment = false, inBlockComment = false;
for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
  const line = lines[lineIndex];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (inLineComment) continue;
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
        continue;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
  }
  inLineComment = false;
  if (lineIndex >= 300 && lineIndex <= 451) {
    console.log(`${lineIndex + 1}: braces=${braces} parens=${parens} brackets=${brackets} | ${lines[lineIndex]}`);
  }
}
console.log('final', { braces, parens, brackets });
