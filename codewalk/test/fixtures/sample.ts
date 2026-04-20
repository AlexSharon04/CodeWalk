// A sample file used by the segmenter integration test.

import { readFileSync } from "node:fs";

interface Config {
  host: string;
  port: number;
}

function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Partial<Config>;
  if (typeof parsed.host !== "string") throw new Error("host missing");
  if (typeof parsed.port !== "number") throw new Error("port missing");
  return { host: parsed.host, port: parsed.port };
}

function startServer(config: Config): void {
  console.log(`starting server on ${config.host}:${config.port}`);
}

const cfg = loadConfig("./config.json");
startServer(cfg);
