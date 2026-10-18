# NovaCut

Editor de vídeo desktop para Windows (MVP em desenvolvimento). Tauri 2 + React + TypeScript,
com FFmpeg executado como processo separado.

## Pré-requisitos (Windows)

- Node.js 24+ e npm
- Rust (toolchain `stable-x86_64-pc-windows-msvc`, via rustup)
- Visual Studio 2022 Build Tools com a carga "Desenvolvimento para desktop com C++" e Windows SDK
- WebView2 Runtime (já vem no Windows 11)
- FFmpeg + ffprobe no PATH, ou na pasta indicada por `NOVACUT_FFMPEG_DIR`

## Comandos

```bash
npm install          # dependências do frontend
npm run tauri dev    # abre o app em modo desenvolvimento
npm test             # testes do core (Vitest)
npm run test:rust    # testes do backend (cargo test)
npm run build        # typecheck + build do frontend
```

## Arquitetura

```
src/core/       lógica pura, sem React nem Tauri (testada com Vitest)
  time.ts         tempo em microssegundos inteiros, frames e timecode
  timeline/       régua (e, nas próximas etapas, operações de timeline)
src/platform/   adaptadores para comandos Tauri (ffmpeg.ts)
src/ui/         componentes React e tema escuro
src-tauri/src/  backend Rust: localização/diagnóstico do FFmpeg (ffmpeg.rs)
```

Regra: o modelo nunca guarda tempo em segundos `float`; tudo é `Micros` (inteiro).

## FFmpeg e licenças

- O NovaCut usa um build **LGPL** do FFmpeg (desenvolvimento: `BtbN.FFmpeg.LGPL.Shared.8.1`, que é
  LGPLv3) e o executa como processo separado; nada do FFmpeg é linkado ao app.
- Builds LGPL não têm `libx264` nem o filtro `eq`. H.264 é gerado por `h264_amf` / `h264_nvenc` /
  `h264_qsv` (GPU), `h264_mf` (Media Foundation; em hardware exige entrada `nv12`) ou `libopenh264`.
- Brilho/contraste usam `lutrgb` com a mesma fórmula do CSS `brightness(b) contrast(c)`:
  `out = clip((in·b − 0,5)·c + 0,5)`, para o preview e a exportação coincidirem.
- Ao distribuir: incluir o texto da LGPL, o link para o código-fonte do build usado e a
  atribuição ao projeto FFmpeg. A licença de patentes do OpenH264 da Cisco só cobre o binário
  distribuído pela própria Cisco — revisar antes de distribuir. H.264/AAC têm patentes: buscar
  orientação jurídica antes de distribuição comercial.

## Estado

- [x] Etapa 1 — estrutura do projeto, casca da UI em tema escuro, diagnóstico do FFmpeg
- [ ] Etapa 2 — formato de projeto `.ncproj` (salvar/abrir)
- [ ] Etapa 3 — importação + ffprobe + biblioteca de mídias
- [ ] Etapa 4 — modelo da timeline (adicionar, mover, cortar, dividir, desfazer)
- [ ] Etapa 5 — interação da timeline
- [ ] Etapa 6 — motor de pré-visualização
- [ ] Etapa 7 — propriedades: volume, velocidade, brilho, contraste
- [ ] Etapa 8 — exportação MP4
- [ ] Etapa 9 — empacotamento com FFmpeg e licenças
