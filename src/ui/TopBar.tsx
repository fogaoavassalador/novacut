import { useEffect, useState } from "react";
import type { ProjectDocument } from "../state/document";

interface TopBarProps {
  doc: ProjectDocument;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onRename: (name: string) => void;
}

export function TopBar({ doc, onNew, onOpen, onSave, onSaveAs, onRename }: TopBarProps) {
  const [draft, setDraft] = useState(doc.project.name);
  useEffect(() => setDraft(doc.project.name), [doc.project.name]);

  const commit = () => {
    if (draft.trim()) onRename(draft);
    else setDraft(doc.project.name);
  };

  return (
    <header className="topbar">
      <div className="brand">
        Nova<span>Cut</span>
      </div>
      <nav className="file-actions" aria-label="Arquivo">
        <button onClick={onNew} title="Novo projeto (Ctrl+N)">Novo</button>
        <button onClick={onOpen} title="Abrir projeto (Ctrl+O)">Abrir…</button>
        <button onClick={onSave} title="Salvar (Ctrl+S)">Salvar</button>
        <button onClick={onSaveAs} title="Salvar como (Ctrl+Shift+S)">Salvar como…</button>
      </nav>
      <input
        className="project-name-input"
        aria-label="Nome do projeto"
        value={draft}
        maxLength={200}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(doc.project.name);
            e.currentTarget.blur();
          }
        }}
      />
      {doc.dirty && (
        <span className="dirty-flag" title="Alterações não salvas">
          não salvo
        </span>
      )}
      <span className="file-path" title={doc.filePath ?? undefined}>
        {doc.filePath ?? "Ainda não salvo em disco"}
      </span>
    </header>
  );
}
