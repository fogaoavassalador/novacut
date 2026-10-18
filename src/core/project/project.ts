import {
  CURRENT_FORMAT_VERSION,
  PROJECT_FORMAT,
  type Clip,
  type MediaRef,
  type Project,
  type ProjectSettings,
  type Track,
} from "./schema";

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  sampleRate: 48000,
  background: "#000000",
};

export function newId(): string {
  return crypto.randomUUID();
}

export function createEmptyProject(
  name = "Projeto sem título",
  now: Date = new Date(),
  settings: ProjectSettings = DEFAULT_SETTINGS,
): Project {
  const ts = now.toISOString();
  return {
    format: PROJECT_FORMAT,
    formatVersion: CURRENT_FORMAT_VERSION,
    id: newId(),
    name,
    createdAt: ts,
    modifiedAt: ts,
    settings: { ...settings },
    media: [],
    tracks: [
      { id: newId(), kind: "video", name: "V2", muted: false, hidden: false, clips: [] },
      { id: newId(), kind: "video", name: "V1", muted: false, hidden: false, clips: [] },
      { id: newId(), kind: "audio", name: "A1", muted: false, hidden: false, clips: [] },
    ],
  };
}

/** Duração do clipe na timeline, considerando a velocidade. */
export function clipDurationUs(clip: Clip): number {
  return Math.round((clip.sourceOutUs - clip.sourceInUs) / clip.speed);
}

export function clipEndUs(clip: Clip): number {
  return clip.timelineStartUs + clipDurationUs(clip);
}

/** Fim do último clipe de todas as faixas. */
export function projectDurationUs(project: Project): number {
  let end = 0;
  for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, clipEndUs(c));
  return end;
}

/** Uma faixa de vídeo aceita vídeo e imagem; uma de áudio aceita áudio ou vídeo com som. */
export function mediaFitsTrack(media: MediaRef, track: Track): boolean {
  if (track.kind === "video") return media.kind === "video" || media.kind === "image";
  return media.kind === "audio" || (media.kind === "video" && media.hasAudio);
}

export interface ProjectIssue {
  path: string;
  message: string;
}

/**
 * Regras que o schema sozinho não expressa. Lista vazia = projeto consistente.
 */
export function checkInvariants(project: Project): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const seen = new Set<string>();
  const unique = (value: string, path: string) => {
    if (seen.has(value)) issues.push({ path, message: `id duplicado "${value}"` });
    seen.add(value);
  };

  const media = new Map<string, MediaRef>();
  project.media.forEach((m, i) => {
    unique(m.id, `media[${i}].id`);
    media.set(m.id, m);
    if (m.kind === "image" && m.durationUs !== null)
      issues.push({ path: `media[${i}].durationUs`, message: "imagem não tem duração" });
    if (m.kind !== "image" && m.durationUs === null)
      issues.push({ path: `media[${i}].durationUs`, message: "duração ausente" });
  });

  project.tracks.forEach((track, ti) => {
    unique(track.id, `tracks[${ti}].id`);
    const sorted = [...track.clips].sort((a, b) => a.timelineStartUs - b.timelineStartUs);

    track.clips.forEach((clip, ci) => {
      const at = `tracks[${ti}].clips[${ci}]`;
      unique(clip.id, `${at}.id`);
      if (clip.sourceOutUs <= clip.sourceInUs)
        issues.push({ path: at, message: "sourceOutUs deve ser maior que sourceInUs" });
      const m = media.get(clip.mediaId);
      if (!m) {
        issues.push({ path: `${at}.mediaId`, message: `mídia "${clip.mediaId}" não existe` });
        return;
      }
      if (!mediaFitsTrack(m, track))
        issues.push({ path: at, message: `mídia do tipo ${m.kind} não cabe em faixa de ${track.kind}` });
      if (m.durationUs !== null && clip.sourceOutUs > m.durationUs)
        issues.push({ path: `${at}.sourceOutUs`, message: "ultrapassa a duração da mídia" });
    });

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].timelineStartUs < clipEndUs(sorted[i - 1]))
        issues.push({
          path: `tracks[${ti}]`,
          message: `clipes "${sorted[i - 1].id}" e "${sorted[i].id}" se sobrepõem`,
        });
    }
  });

  return issues;
}
