// Embeds the compiled factory and adapter into artifacts.json after `forge build`.
// The page and the dry run read creation code, runtime code, immutable offsets and ABIs from it,
// and record the source hashes so a deployment record names exactly what was compiled.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sha256 = (text) => `0x${createHash("sha256").update(text).digest("hex")}`;

function pick(name, source) {
  const artifact = JSON.parse(read(`out/${name}.sol/${name}.json`));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    deployedBytecode: artifact.deployedBytecode.object,
    // Keyed by position rather than by AST node id, which changes between Foundry versions.
    immutableReferences: Object.fromEntries(Object.values(artifact.deployedBytecode.immutableReferences ?? {}).map((ranges, i) => [String(i), ranges])),
    compiler: artifact.metadata?.compiler?.version ?? "0.8.24",
    sourceSha256: sha256(read(source)),
  };
}

const output = {
  generatedAt: new Date().toISOString(),
  NamepassFactory: pick("NamepassFactory", "contracts/NamepassFactory.sol"),
  ENSV2RenewalAdapter: pick("ENSV2RenewalAdapter", "contracts/ENSV2RenewalAdapter.sol"),
  /** Used by `tools/resolver-deployment`; the resolver is not part of the CREATE2 set. */
  NamepassResolver: pick("NamepassResolver", "contracts/NamepassResolver.sol"),
};

const path = new URL("artifacts.json", import.meta.url);
const text = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = JSON.parse(readFileSync(path, "utf8"));
  for (const name of ["NamepassFactory", "ENSV2RenewalAdapter", "NamepassResolver"]) {
    const { generatedAt: _a, ...a } = { generatedAt: 0, ...current[name] };
    const { generatedAt: _b, ...b } = { generatedAt: 0, ...output[name] };
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${name} artifact is stale; run build-artifacts.mjs`);
  }
  console.log("artifacts.json matches the build");
} else {
  writeFileSync(path, text);
  console.log("wrote artifacts.json");
}
