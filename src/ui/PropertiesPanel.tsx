import { useEffect, useRef, useState } from "react";
import { clipDurationUs, newId } from "../core/project/project";
import type { MediaRef, Project } from "../core/project/schema";
import { US_PER_SECOND } from "../core/time";
import { findClip, PROP_LIMITS, type ClipProps } from "../core/timeline/ops";
import type { EditAction } from "../state/document";

interface PropertiesPanelProps {
  project: Project;
  selected: ReadonlySet<string>;
  onEdit: (action: EditAction) => void;
}

interface Field {
  key: keyof ClipProps;
  label: string;
  /** Valor exibido ↔ valor do modelo (ex.: 150% ↔ 1,5). */
  toDisplay: (v: number) => number;
  fromDisplay: (v: number) => number;
  unit: string;
  sliderMin: number;
  sliderMax: number;
  step: number;
  /** Motivo para o campo não se aplicar à mídia, ou `null`. */
  unavailable: (m: MediaRef, track: "video" | "audio") => string | null;
}

const pct = { toDisplay: (v: number) => Math.round(v * 100), fromDisplay: (v: number) => v / 100, unit: "%" };

const FIELDS: Field[] = [
  {
    key: "volume",
    label: "Volume",
    ...pct,
    sliderMin: 0,
    sliderMax: PROP_LIMITS.volume.max * 100,
    step: 1,
    unavailable: (m) => (m.hasAudio ? null : "a mídia não tem som"),
  },
  {
    key: "speed",
    label: "Velocidade",
    toDisplay: (v) => Math.round(v * 100) / 100,
    fromDisplay: (v) => v,
    unit: "×",
    sliderMin: 0.25,
    sliderMax: 4,
    step: 0.05,
    unavailable: (m) => (m.kind === "image" ? "imagens não têm velocidade" : null),
  },
  {
    key: "brightness",
    label: "Brilho",
    ...pct,
    sliderMin: 0,
    sliderMax: PROP_LIMITS.brightness.max * 100,
    step: 1,
    unavailable: (m, track) => (track === "audio" || !m.hasVideo ? "só para imagem" : null),
  },
  {
    key: "contrast",
    label: "Contraste",
    ...pct,
    sliderMin: 0,
    sliderMax: PROP_LIMITS.contrast.max * 100,
    step: 1,
    unavailable: (m, track) => (track === "audio" || !m.hasVideo ? "só para imagem" : null),
  },
];

const DEFAULTS: ClipProps = { volume: 1, speed: 1, brightness: 1, contrast: 1 };

export function PropertiesPanel({ project, selected, onEdit }: PropertiesPanelProps) {
  const items = [...selected]
    .map((id) => findClip(project, id))
    .filter((l): l is NonNullable<typeof l> => !!l)
    .map((l) => ({ clip: l.clip, track: l.track, media: project.media.find((m) => m.id === l.clip.mediaId)! }))
    .filter((i) => i.media);

  if (!items.length)
    return (
      <div className="empty-state">
        <strong>Nenhum clipe selecionado</strong>
        Selecione um clipe na timeline para ajustar volume, velocidade, brilho e contraste.
      </div>
    );

  const primary = items[0];
  const ids = items.map((i) => i.clip.id);
  const set = (props: Partial<ClipProps>, coalesceKey?: string) => onEdit({ type: "setClipProps", clipIds: ids, props, coalesceKey });

  return (
    <div className="props">
      <div className="props-title" title={primary.media.path}>
        {items.length === 1 ? primary.media.name : `${items.length} clipes selecionados`}
      </div>
      <div className="props-meta">
        {items.length === 1
          ? `Duração na timeline: ${(clipDurationUs(primary.clip) / US_PER_SECOND).toFixed(2)} s`
          : "Os ajustes valem para todos os selecionados."}
      </div>

      {FIELDS.map((f) => {
        const reasons = items.map((i) => f.unavailable(i.media, i.track.kind)).filter(Boolean);
        const disabled = reasons.length === items.length ? reasons[0] : null;
        const values = items.map((i) => i.clip[f.key]);
        const mixed = values.some((v) => v !== values[0]);
        return (
          <PropertyRow
            key={f.key}
            field={f}
            value={primary.clip[f.key]}
            mixed={mixed}
            disabledReason={disabled}
            onChange={set}
          />
        );
      })}

      <button
        className="props-reset-all"
        onClick={() => set(DEFAULTS)}
        disabled={items.every((i) => (Object.keys(DEFAULTS) as (keyof ClipProps)[]).every((k) => i.clip[k] === DEFAULTS[k]))}
      >
        Redefinir tudo
      </button>
    </div>
  );
}

interface PropertyRowProps {
  field: Field;
  value: number;
  mixed: boolean;
  disabledReason: string | null;
  onChange: (props: Partial<ClipProps>, coalesceKey?: string) => void;
}

function PropertyRow({ field: f, value, mixed, disabledReason, onChange }: PropertyRowProps) {
  const shown = f.toDisplay(value);
  const [text, setText] = useState(String(shown));
  const editing = useRef(false);
  const dragKey = useRef<string | null>(null);
  useEffect(() => {
    if (!editing.current) setText(mixed ? "" : String(shown));
  }, [shown, mixed]);

  const lim = PROP_LIMITS[f.key];
  const commitText = () => {
    editing.current = false;
    const n = Number(text.replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(n)) return setText(mixed ? "" : String(shown));
    const v = Math.min(lim.max, Math.max(lim.min, f.fromDisplay(n)));
    if (v !== value || mixed) onChange({ [f.key]: v });
    setText(String(f.toDisplay(v)));
  };
  const disabled = disabledReason !== null;

  return (
    <div className={`props-row${disabled ? " disabled" : ""}`} data-prop={f.key} title={disabledReason ?? undefined}>
      <label className="props-label" htmlFor={`prop-${f.key}`}>
        {f.label}
      </label>
      <input
        className="props-slider"
        type="range"
        min={f.sliderMin}
        max={f.sliderMax}
        step={f.step}
        value={Math.min(f.sliderMax, Math.max(f.sliderMin, shown))}
        disabled={disabled}
        onPointerDown={() => (dragKey.current = `drag-${f.key}-${newId()}`)}
        onKeyDown={() => (dragKey.current = `key-${f.key}-${newId()}`)}
        onChange={(e) => onChange({ [f.key]: f.fromDisplay(Number(e.target.value)) }, dragKey.current ?? undefined)}
        aria-label={f.label}
      />
      <span className="props-input-wrap">
        <input
          id={`prop-${f.key}`}
          className="props-input"
          inputMode="decimal"
          value={text}
          placeholder={mixed ? "vários" : undefined}
          disabled={disabled}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              editing.current = false;
              setText(mixed ? "" : String(shown));
              e.currentTarget.blur();
            }
          }}
        />
        <span className="props-unit">{f.unit}</span>
      </span>
      <button
        className="props-reset"
        disabled={disabled || (!mixed && value === DEFAULTS[f.key])}
        onClick={() => onChange({ [f.key]: DEFAULTS[f.key] })}
        title={`Redefinir ${f.label.toLowerCase()}`}
        aria-label={`Redefinir ${f.label.toLowerCase()}`}
      >
        ↺
      </button>
    </div>
  );
}

