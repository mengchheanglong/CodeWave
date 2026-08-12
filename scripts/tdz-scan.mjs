import ts from "typescript";

const file = process.argv[2];
if (!file) {
  console.error("usage: node tdz-scan.mjs <file.tsx>");
  process.exit(1);
}

const opts = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: false,
  skipLibCheck: true,
  noEmit: true,
};
const program = ts.createProgram([file], opts);
const sf = program.getSourceFile(file);
if (!sf) {
  console.error("cannot parse:", file);
  process.exit(1);
}

// Find all function declarations that look like components (capitalized names)
const functions = [];
function walk(node) {
  if (node) {
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) {
      functions.push(node);
    }
  }
  if (node) ts.forEachChild(node, walk);
}
walk(sf);
if (functions.length === 0) {
  console.log("No component functions found");
  process.exit(0);
}

const allProblems = [];
for (const appNode of functions) {
  // Collect const declarations at the top level of the component body.
  const declLines = new Map();
  function collectTopLevelDecls(stmt) {
    if (ts.isVariableStatement(stmt)) {
      const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const decl of stmt.declarationList.declarations) {
        if (isConst && ts.isIdentifier(decl.name)) {
          const line = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1;
          if (!declLines.has(decl.name.text)) {
            declLines.set(decl.name.text, line);
          }
        }
      }
      return;
    }
    if (ts.isIfStatement(stmt) || ts.isBlock(stmt)) {
      ts.forEachChild(stmt, (child) => {
        if (ts.isStatement(child)) collectTopLevelDecls(child);
      });
    }
  }
  for (const stmt of appNode.body.statements) {
    collectTopLevelDecls(stmt);
  }

  // Walk eager positions (outside nested function bodies) and flag references
  // whose declaration line is later than the reference line.
  function scan(node, inNestedFn) {
    if (ts.isIdentifier(node)) {
      const text = node.text;
      if (!inNestedFn) {
        const refLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const declLine = declLines.get(text);
        if (declLine && declLine > refLine) {
          allProblems.push({ text, refLine, declLine, fn: appNode.name.text });
        }
      }
      return;
    }
    const nested = inNestedFn || ts.isFunctionLike(node);
    ts.forEachChild(node, (child) => scan(child, nested));
  }
  scan(appNode.body, false);
}

const unique = [
  ...new Map(allProblems.map((p) => [`${p.text}@${p.declLine}@${p.fn}`, p])).values(),
];
unique.sort((a, b) => a.refLine - b.refLine);
for (const p of unique) {
  console.log(`ref line ${p.refLine} [${p.fn}]: '${p.text}' declared at line ${p.declLine}`);
}
console.log("total:", unique.length);
