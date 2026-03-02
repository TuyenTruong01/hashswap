import fs from "fs";
import path from "path";

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

export function upsertDeployed(deployedPath, patch) {
  const cur = readJson(deployedPath, {});
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  writeJson(deployedPath, next);
  return next;
}