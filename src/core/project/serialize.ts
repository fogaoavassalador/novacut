import { checkInvariants, type ProjectIssue } from "./project";
import { CURRENT_FORMAT_VERSION, PROJECT_FORMAT, projectSchema, type Project } from "./schema";

export type ParseResult = { ok: true; project: Project } | { ok: false; issues: ProjectIssue[] };

/**
 * Migrações: `MIGRATIONS[n]` converte um objeto da versão n para n + 1.
 * Ainda não existe versão anterior à 1; ao criar a versão 2, registre aqui a 1→2.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2) + "\n";
}

export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail("", `JSON inválido: ${(e as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return fail("", "o arquivo não contém um objeto de projeto");

  let obj = raw as Record<string, unknown>;
  if (obj.format !== PROJECT_FORMAT) return fail("format", "não é um projeto NovaCut");

  const version = obj.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    return fail("formatVersion", "versão do formato ausente ou inválida");
  if (version > CURRENT_FORMAT_VERSION)
    return fail(
      "formatVersion",
      `projeto criado por uma versão mais nova do NovaCut (formato ${version}; suportado até ${CURRENT_FORMAT_VERSION})`,
    );

  for (let v = version; v < CURRENT_FORMAT_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) return fail("formatVersion", `sem migração da versão ${v} para ${v + 1}`);
    obj = { ...migrate(obj), formatVersion: v + 1 };
  }

  const parsed = projectSchema.safeParse(obj);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const issues = checkInvariants(parsed.data);
  return issues.length ? { ok: false, issues } : { ok: true, project: parsed.data };
}

function fail(path: string, message: string): ParseResult {
  return { ok: false, issues: [{ path, message }] };
}
