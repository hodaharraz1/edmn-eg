/**
 * Generates typed Dart models for the Flutter apps from the committed OpenAPI contracts:
 *   npx tsx scripts/generate-dart-api.ts          → packages/edmn_api/lib/src/generated/{mobile,admin}_api.dart
 *   npx tsx scripts/generate-dart-api.ts --check  → exit 1 if the generated files are stale
 *
 * Deliberately small and dependency-free (no build_runner, no Java generator): every component schema and every
 * inline request/response object becomes an immutable class with fromJson/toJson. Enums stay `String` so a value the
 * server adds later never crashes an older build; money fields stay `int` piastres.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  $ref?: string;
  enum?: unknown[];
  const?: unknown;
  description?: string;
  additionalProperties?: Schema | boolean;
};

const pascal = (s: string) => s.replace(/(^|[^A-Za-z0-9])([A-Za-z0-9])/g, (_, __, c: string) => c.toUpperCase());
const DART_RESERVED = new Set(['default', 'class', 'enum', 'new', 'is', 'in', 'switch', 'case', 'with', 'final', 'const', 'var', 'void', 'null', 'true', 'false']);
const field = (n: string) => (DART_RESERVED.has(n) ? `${n}_` : n);

class Gen {
  classes = new Map<string, string>();
  constructor(private readonly components: Record<string, Schema>) {}

  /** Unwraps `anyOf [X, null]` and `type: [X, 'null']` into (schema, nullable). */
  private unwrap(s: Schema): { s: Schema; nullable: boolean } {
    if (s.anyOf) {
      const nonNull = s.anyOf.filter((x) => x.type !== 'null');
      if (nonNull.length === 1) return { s: nonNull[0], nullable: nonNull.length !== s.anyOf.length };
    }
    if (Array.isArray(s.type) && s.type.includes('null')) {
      const t = s.type.filter((x) => x !== 'null');
      return { s: { ...s, type: t.length === 1 ? t[0] : t }, nullable: true };
    }
    return { s, nullable: false };
  }

  /** Dart type + (de)serialization expressions for a schema used at `hint` (class name for inline objects). */
  type(raw: Schema, hint: string): { dart: string; from: (v: string) => string; to: (v: string) => string } {
    const { s, nullable } = this.unwrap(raw);
    const q = nullable ? '?' : '';
    const guard = (expr: (v: string) => string) => (v: string) => (nullable ? `${v} == null ? null : ${expr(v)}` : expr(v));
    if (s.$ref) {
      const name = s.$ref.split('/').pop()!;
      this.model(name, this.components[name]);
      return { dart: `${name}${q}`, from: guard((v) => `${name}.fromJson(${v} as Map<String, dynamic>)`), to: (v) => `${v}${q}.toJson()` };
    }
    const t = Array.isArray(s.type) ? s.type[0] : s.type;
    if (t === 'string') return { dart: `String${q}`, from: (v) => `${v} as String${q}`, to: (v) => v };
    if (t === 'integer') return { dart: `int${q}`, from: (v) => `(${v} as num${q})${q}.toInt()`, to: (v) => v };
    if (t === 'number') return { dart: `double${q}`, from: (v) => `(${v} as num${q})${q}.toDouble()`, to: (v) => v };
    if (t === 'boolean') return { dart: `bool${q}`, from: (v) => `${v} as bool${q}`, to: (v) => v };
    if (t === 'array') {
      const inner = this.type(s.items ?? {}, `${hint}Item`);
      return {
        dart: `List<${inner.dart}>${q}`,
        from: guard((v) => `(${v} as List).map((e) => ${inner.from('e')}).toList()`),
        to: (v) => `${v}${q}.map((e) => ${inner.to('e')}).toList()`,
      };
    }
    if (t === 'object' && s.properties) {
      this.model(hint, s);
      return { dart: `${hint}${q}`, from: guard((v) => `${hint}.fromJson(${v} as Map<String, dynamic>)`), to: (v) => `${v}${q}.toJson()` };
    }
    if (t === 'object' && typeof s.additionalProperties === 'object') {
      const inner = this.type(s.additionalProperties, `${hint}Value`);
      return {
        dart: `Map<String, ${inner.dart}>${q}`,
        from: guard((v) => `(${v} as Map<String, dynamic>).map((k, e) => MapEntry(k, ${inner.from('e')}))`),
        to: (v) => v,
      };
    }
    return { dart: 'Object?', from: (v) => v, to: (v) => v };
  }

  model(name: string, s: Schema) {
    if (this.classes.has(name)) return;
    this.classes.set(name, ''); // reserve first: recursive schemas (Category.children) reference themselves
    const props = Object.entries(s.properties ?? {});
    const required = new Set(s.required ?? []);
    const fields = props.map(([key, ps]) => {
      const t = this.type(ps, `${name}${pascal(key)}`);
      const optional = !required.has(key) && !t.dart.endsWith('?');
      const dart = optional ? `${t.dart}?` : t.dart;
      const values = this.unwrap(ps).s.enum;
      const doc = [ps.description ?? this.unwrap(ps).s.description, values ? `One of: ${values.join(', ')} (kept as String for forward compatibility).` : null].filter(Boolean).join(' ');
      const from = optional ? `json['${key}'] == null ? null : ${t.from(`json['${key}']`)}` : t.from(`json['${key}']`);
      const to = optional ? t.to(field(key)).replace(new RegExp(`^${field(key)}\\.`), `${field(key)}?.`) : t.to(field(key));
      return { key, name: field(key), dart, from, to, doc, optional };
    });
    const lines: string[] = [];
    if (s.description) lines.push(`/// ${s.description}`);
    lines.push(`class ${name} {`);
    lines.push(`  const ${name}(${fields.length ? `{${fields.map((f) => `${f.optional ? '' : 'required '}this.${f.name}`).join(', ')}}` : ''});`);
    lines.push('');
    lines.push(`  factory ${name}.fromJson(Map<String, dynamic> json) => ${name}(${fields.map((f) => `${f.name}: ${f.from}`).join(', ')});`);
    for (const f of fields) {
      lines.push('');
      if (f.doc) lines.push(`  /// ${f.doc}`);
      lines.push(`  final ${f.dart} ${f.name};`);
    }
    lines.push('');
    lines.push(`  Map<String, dynamic> toJson() => {${fields.map((f) => `'${f.key}': ${f.to}`).join(', ')}};`);
    lines.push('}');
    this.classes.set(name, lines.join('\n'));
  }
}

function generate(api: 'mobile' | 'admin'): string {
  const doc = JSON.parse(readFileSync(join(process.cwd(), 'openapi', `${api}.v1.json`), 'utf8'));
  const g = new Gen(doc.components.schemas);
  for (const name of Object.keys(doc.components.schemas).sort()) if (doc.components.schemas[name].properties) g.model(name, doc.components.schemas[name]);
  const ops: string[] = [];
  for (const [path, methods] of Object.entries<Record<string, { operationId: string; requestBody?: { content: Record<string, { schema: Schema }> }; responses: Record<string, { content?: Record<string, { schema: Schema }> }> }>>(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const id = pascal(op.operationId);
      const body = op.requestBody?.content['application/json']?.schema;
      if (body && !body.$ref) g.type(body, `${id}Request`);
      const okStatus = Object.keys(op.responses).find((s) => s.startsWith('2'))!;
      const res = op.responses[okStatus].content?.['application/json']?.schema;
      if (res && !res.$ref) g.type(res, `${id}Response`);
      ops.push(`  static const ${op.operationId} = (method: '${method.toUpperCase()}', path: '${path}');`);
    }
  }
  return [
    '// GENERATED by scripts/generate-dart-api.ts from openapi/' + api + '.v1.json — do not edit by hand.',
    '// ignore_for_file: type=lint',
    '',
    `/// Operation paths of the ${api === 'admin' ? 'Admin' : 'Customer'} App API (method + OpenAPI path template).`,
    `abstract final class ${api === 'admin' ? 'AdminApiPaths' : 'MobileApiPaths'} {`,
    ...ops.sort(),
    '}',
    '',
    ...[...g.classes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, code]) => code + '\n'),
  ].join('\n');
}

const out = join(process.cwd(), 'packages/edmn_api/lib/src/generated');
const check = process.argv.includes('--check');
let stale = false;
mkdirSync(out, { recursive: true });
for (const api of ['mobile', 'admin'] as const) {
  const file = join(out, `${api}_api.dart`);
  const next = generate(api);
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {}
  if (current === next) continue;
  if (check) {
    console.error(`stale: ${file} (run npx tsx scripts/generate-dart-api.ts)`);
    stale = true;
  } else {
    writeFileSync(file, next);
    console.log(`wrote ${file}`);
  }
}
process.exit(stale ? 1 : 0);
