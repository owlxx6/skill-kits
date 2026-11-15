import path from "node:path";
import { readYamlFile } from "../../../pipeline/lib/store";
import { type Config, ConfigSchema } from "../../../pipeline/lib/schemas";

// The build runs from the repository root, and import.meta.url points into the bundled output.
const CONFIG_PATH = path.join(process.cwd(), "data", "config.yaml");

// The page publishes the real thresholds and weights, read at build time.
export function loadConfig(): Promise<Config> {
  return readYamlFile(CONFIG_PATH, ConfigSchema);
}
