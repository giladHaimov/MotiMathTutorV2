import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const csvPath = new URL('../table-problems-bootstrap.csv', import.meta.url);
const migrationPath = new URL('../db/migrations/0000_init.sql', import.meta.url);
const columns = [
  'id',
  'program_id',
  'problem_key',
  'version',
  'domain',
  'title',
  'difficulty_level',
  'full_text',
  'definition',
  'status',
];
const start = '-- BEGIN GENERATED PROBLEMS BOOTSTRAP';
const end = '-- END GENERATED PROBLEMS BOOTSTRAP';

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (field !== '' || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

const [header, ...values] = parseCsv(readFileSync(csvPath, 'utf8'));
if (!header || header.join(',') !== columns.join(',')) {
  throw new Error(`Malformed CSV: required columns are exactly: ${columns.join(', ')}`);
}
if (values.length === 0) throw new Error('Malformed CSV: at least one data row is required');

const seenIds = new Set();
const seenKeys = new Set();
const records = values
  .map((row, index) => {
    if (row.length !== columns.length) {
      throw new Error(`Malformed CSV row ${index + 2}: expected ${columns.length} columns`);
    }
    const record = Object.fromEntries(columns.map((column, i) => [column, row[i].trim()]));
    for (const column of columns) {
      if (!record[column]) throw new Error(`Malformed CSV row ${index + 2}: ${column} is required`);
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        record.id,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        record.program_id,
      )
    ) {
      throw new Error(`Malformed CSV row ${index + 2}: id and program_id must be UUIDs`);
    }
    if (!/^[1-9]\d*$/.test(record.version) || !/^(?:[1-9]|10)$/.test(record.difficulty_level)) {
      throw new Error(`Malformed CSV row ${index + 2}: invalid version or difficulty_level`);
    }
    if (
      !['PERCENT', 'RATIO', 'FRACTION'].includes(record.domain) ||
      !['DRAFT', 'ACTIVE', 'RETIRED'].includes(record.status)
    ) {
      throw new Error(`Malformed CSV row ${index + 2}: invalid domain or status`);
    }
    try {
      record.definition = JSON.stringify(JSON.parse(record.definition));
    } catch {
      throw new Error(`Malformed CSV row ${index + 2}: definition must be valid JSON`);
    }
    const key = `${record.program_id}\0${record.problem_key}\0${record.version}`;
    if (seenIds.has(record.id) || seenKeys.has(key)) {
      throw new Error(`Duplicate CSV row ${index + 2}: id or (program_id, problem_key, version)`);
    }
    seenIds.add(record.id);
    seenKeys.add(key);
    return record;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const sql = records
  .map(
    (record) =>
      `INSERT INTO "problems" ("id","program_id","problem_key","version","domain","title","difficulty_level","full_text","definition","status") VALUES (${[
        quote(record.id),
        quote(record.program_id),
        quote(record.problem_key),
        record.version,
        quote(record.domain),
        quote(record.title),
        record.difficulty_level,
        quote(record.full_text),
        `${quote(record.definition)}::jsonb`,
        quote(record.status),
      ].join(',')});`,
  )
  .join('\n');

const migration = readFileSync(migrationPath, 'utf8');
const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
if (!pattern.test(migration))
  throw new Error('Generated bootstrap markers are missing from migration');
writeFileSync(migrationPath, migration.replace(pattern, `${start}\n${sql}\n${end}`));
