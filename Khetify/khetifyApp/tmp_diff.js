import fs from 'fs';
const code = fs.readFileSync('src/pages/seller/SellerProductCatalog.jsx','utf8');
const lines = code.split(/\r?\n/);
let braces = 0, parens = 0, brackets = 0;
let inString = null, escaped = false, inLine = false, inBlock = false;
for (let li = 0; li < lines.length; li++) {
  const line = lines[li];
  let dBrace = 0, dParen = 0, dBracket = 0;
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
    if (ch === '(') { parens++; dParen++; }
    else if (ch === ')') { parens--; dParen--; }
    else if (ch === '[') { brackets++; dBracket++; }
    else if (ch === ']') { brackets--; dBracket--; }
    else if (ch === '{') { braces++; dBrace++; }
    else if (ch === '}') { braces--; dBrace--; }
  }
  inLine = false;
  if (li >= 300 && li <= 451) {
    if (dBrace !== 0 || dParen !== 0 || dBracket !== 0 || braces !== 1 || parens !== 1 || brackets !== 0) {
      console.log(`${li+1}: dB=${dBrace} dP=${dParen} dBr=${dBracket} totalB=${braces} totalP=${parens} totalBr=${brackets} | ${line}`);
    }
  }
}
console.log('final', { braces, parens, brackets });
