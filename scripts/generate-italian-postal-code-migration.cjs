const fs = require("fs");
const path = require("path");
const Papa = require("../frontend/node_modules/papaparse");

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  throw new Error("Uso: node scripts/generate-italian-postal-code-migration.cjs input.csv output.sql");
}

const parsed = Papa.parse(fs.readFileSync(inputPath, "utf8"), {
  header: true,
  delimiter: ";",
  skipEmptyLines: true,
});
if (parsed.errors.length) throw new Error(JSON.stringify(parsed.errors.slice(0, 5)));

const quote = (value) => value === null || value === undefined || value === ""
  ? "null"
  : `'${String(value).replace(/'/g, "''")}'`;
const numeric = (value) => {
  const normalized = String(value || "").replace(",", ".").trim();
  return normalized && Number.isFinite(Number(normalized)) ? normalized : "null";
};
const rowSql = (row) => `(${[
  quote(row.cap), quote(row.codice_istat), quote(row.denominazione_ita), quote(row.denominazione_ita_altra || row.denominazione_altra),
  quote(row.sigla_provincia), quote(row.denominazione_provincia), quote(row.tipologia_provincia),
  quote(row.codice_regione), quote(row.denominazione_regione), quote(row.tipologia_regione), quote(row.ripartizione_geografica),
  /^(1|true|s[iì])$/i.test(String(row.flag_capoluogo || "")) ? "true" : "false", quote(row.codice_belfiore),
  numeric(row.lat), numeric(row.lon), numeric(row.superficie_kmq),
].join(",")})`;

const header = [
  "-- Generated from the official Italian postal-code attachment.",
  "truncate table public.italian_postal_codes;",
].join("\n");
const columns = "postal_code,istat_code,municipality_name,municipality_alt_name,province_code,province_name,province_type,region_code,region_name,region_type,geographic_area,is_province_capital,belfiore_code,latitude,longitude,surface_km2";
const chunks = [];
for (let index = 0; index < parsed.data.length; index += 400) {
  chunks.push(`insert into public.italian_postal_codes (${columns}) values\n${parsed.data.slice(index, index + 400).map(rowSql).join(",\n")};`);
}
fs.writeFileSync(path.resolve(outputPath), `${header}\n\n${chunks.join("\n\n")}\n`);
console.log(`Generated ${parsed.data.length} municipality rows in ${chunks.length} batches.`);

