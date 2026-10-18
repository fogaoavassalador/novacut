import { z } from "zod";

/**
 * Formato de projeto NovaCut (.ncproj), versão 1.
 *
 * Convenções:
 * - Todo tempo é um inteiro em microssegundos (sufixo `Us`).
 * - Clipes referenciam mídias pelo `id`; a mídia guarda o caminho do arquivo.
 * - `timelineStartUs` é onde o clipe começa na timeline; `sourceInUs`/`sourceOutUs`
 *   delimitam o trecho usado da mídia. Duração na timeline = (out − in) / speed.
 */
export const PROJECT_FORMAT = "novacut-project" as const;
export const CURRENT_FORMAT_VERSION = 1;
export const PROJECT_EXTENSION = "ncproj";

const micros = z.number().int().nonnegative();
const id = z.string().min(1).max(64);

export const projectSettingsSchema = z.object({
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps: z.number().positive().max(240),
  sampleRate: z.number().int().min(8000).max(192000),
  /** Cor de fundo do quadro, `#rrggbb`. */
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const mediaKindSchema = z.enum(["video", "audio", "image"]);

export const mediaRefSchema = z.object({
  id,
  kind: mediaKindSchema,
  /** Caminho absoluto do arquivo original. */
  path: z.string().min(1),
  name: z.string(),
  /** Duração da mídia; `null` para imagens (duração livre). */
  durationUs: micros.nullable(),
  /** Dimensões de exibição (já com a rotação aplicada). */
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** Taxa de quadros média; `null` para áudio e imagens. */
  fps: z.number().positive().nullable(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
});

export const clipSchema = z.object({
  id,
  mediaId: id,
  timelineStartUs: micros,
  sourceInUs: micros,
  sourceOutUs: micros,
  /** Multiplicador de velocidade (1 = normal). */
  speed: z.number().min(0.1).max(16),
  /** Ganho linear (1 = original, 0 = mudo). */
  volume: z.number().min(0).max(4),
  /** Fator multiplicativo, como CSS `brightness()` (1 = original). */
  brightness: z.number().min(0).max(4),
  /** Fator, como CSS `contrast()` (1 = original). */
  contrast: z.number().min(0).max(4),
});

export const trackKindSchema = z.enum(["video", "audio"]);

export const trackSchema = z.object({
  id,
  kind: trackKindSchema,
  name: z.string().max(64),
  muted: z.boolean(),
  hidden: z.boolean(),
  clips: z.array(clipSchema),
});

export const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  id,
  name: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
  settings: projectSettingsSchema,
  media: z.array(mediaRefSchema),
  /** Ordem de exibição: índice 0 é a faixa do topo (renderizada por cima). */
  tracks: z.array(trackSchema),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaRef = z.infer<typeof mediaRefSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type TrackKind = z.infer<typeof trackKindSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Project = z.infer<typeof projectSchema>;
