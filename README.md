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
npm run samples      # gera mídias sintéticas + samples/demo.ncproj (fora do Git)
```

Um projeto também pode ser aberto pela linha de comando: `novacut.exe caminho\projeto.ncproj`.

### Testes E2E

Os scripts em `scripts/` dirigem o app real pelo protocolo de depuração do WebView2 (CDP, só em
127.0.0.1); os eventos de mouse e teclado vão apenas para a página do NovaCut.

- `e2e-timeline.mjs`: selecionar, arrastar, cortar, dividir, excluir, desfazer, zoom.
- `e2e-preview.mjs`: decodificação via protocolo `asset`, posição de cada mídia no playhead,
  ordem das camadas, reprodução em sincronia, parada no fim e proxy automático de GIF.
- `e2e-properties.mjs`: painel de propriedades (habilitação por tipo de mídia, velocidade e
  duração, recusa sem espaço, controle deslizante = 1 passo de desfazer) e **nível de áudio
  medido na saída** (200% = 2× o nível de 100%). Toca cerca de 2 s de áudio.

Os testes usam o fixture `samples/e2e.ncproj` (regenerado por `npm run samples`) e recarregam a
página. Rode-os numa **instância isolada**, com pasta de dados própria do WebView2, para não
afetar uma janela do NovaCut que você esteja usando:

```powershell
npm run samples
npm run dev                                   # em outro terminal
cargo build --manifest-path src-tauri/Cargo.toml
$env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\novacut-e2e-webview"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9334 --remote-debugging-address=127.0.0.1"
src-tauri\target\debug\novacut.exe samples\e2e.ncproj
$env:CDP_PORT="9334"
node scripts/e2e-timeline.mjs
node scripts/e2e-preview.mjs
node scripts/e2e-properties.mjs
```

## Pré-visualização

- Os arquivos de mídia são lidos pelo protocolo `asset` do Tauri, com escopo **dinâmico**: o
  escopo começa vazio e cada mídia do projeto é autorizada ao ser importada ou aberta.
- Cada clipe ativo (ou que começa nos próximos 2 s) tem seu `<video>`/`<audio>`/`<img>`; as
  regras de "o que aparece em t" estão em `core/preview/composition.ts` e valem também para a
  exportação.
- Formatos que o WebView2 não toca (GIF, ProRes, alguns MKV…) recebem um **proxy** H.264 de até
  1280 px em `%LOCALAPPDATA%\com.novacut.app\proxies`, usado só na pré-visualização.
- O áudio passa pelo Web Audio (elemento → ganho do clipe 0–400% → master → saída). Os elementos
  usam `crossOrigin="anonymous"`: sem isso o WebView entrega silêncio ao grafo para mídias do
  protocolo `asset` (verificado com um tom de 220 Hz).
- Limitações atuais: o relógio é o do sistema (vídeos são corrigidos se se afastarem mais de
  120 ms); o cache de proxies não é limpo automaticamente.

## Painel de propriedades

Volume (0–400%), velocidade (0,1×–16×; deslizante 0,25×–4×), brilho e contraste (0–200%) do clipe
selecionado — ou de todos os selecionados. Cada arraste de controle deslizante é um único passo de
desfazer; campos numéricos aplicam ao pressionar Enter ou sair do campo. Mudar a velocidade muda a
duração na timeline; se o clipe mais lento invadir o vizinho, a mudança é recusada com aviso.
Controles que não se aplicam ficam desabilitados (volume sem som, velocidade em imagem, brilho e
contraste em áudio).

## Atalhos da timeline

| Ação | Atalho |
|---|---|
| Dividir no playhead (selecionados; sem seleção, todos sob o playhead) | `S` ou `Ctrl+B` |
| Excluir selecionados | `Delete` / `Backspace` |
| Selecionar vários / todos | `Ctrl`/`Shift`+clique · `Ctrl+A` |
| Mover o playhead 1 quadro / 1 s | `←` `→` / `Shift+←` `Shift+→` |
| Início / fim | `Home` / `End` |
| Zoom | `Ctrl`+roda (no ponteiro), `+` / `−`, botão Ajustar |
| Rolar a timeline | roda do mouse |
| Cancelar arraste | `Esc` |
| Reproduzir / pausar | `Espaço` |

## Arquitetura

```
src/core/       lógica pura, sem React nem Tauri (testada com Vitest)
  time.ts         tempo em microssegundos inteiros, frames e timecode
  project/        formato .ncproj: schema (zod), invariantes, serializar/ler, migrações
  timeline/       régua e operações puras (ops.ts), com teste de propriedade de invariantes
src/state/      documento aberto (reducer puro) e hook que liga diálogos e arquivos
src/platform/   adaptadores para comandos Tauri (ffmpeg.ts, projectFiles.ts)
src/ui/         componentes React e tema escuro
  media/          probe → MediaRef, deduplicação por caminho, instante da miniatura
  util/           mapLimit (concorrência limitada)
src-tauri/src/  backend Rust: FFmpeg (ffmpeg.rs), análise de mídia e miniaturas (media.rs),
                E/S atômica de projetos (project.rs)
src-tauri/tests/ IPC ponta a ponta (tauri::test) e integração com FFmpeg real (mídias sintéticas)
scripts/        make-samples.mjs
```

Regra: o modelo nunca guarda tempo em segundos `float`; tudo é `Micros` (inteiro).

## Formato de projeto (.ncproj)

JSON UTF-8 com `format: "novacut-project"` e `formatVersion` (atual: 1). Contém `settings`
(resolução, fps, taxa de amostragem, fundo), `media` (arquivos referenciados por caminho absoluto)
e `tracks` (faixas; índice 0 = topo) com `clips` que apontam para mídias por `mediaId`.

- Ao abrir, o arquivo passa pelo schema e por invariantes: ids únicos, mídias existentes,
  `sourceOutUs > sourceInUs`, trecho dentro da duração da mídia, sem sobreposição na mesma
  faixa e tipo de mídia compatível com a faixa.
- Arquivos de versão mais nova são recusados com mensagem clara; versões antigas passam pela
  cadeia de migrações em `serialize.ts`.
- Um projeto inconsistente nunca é gravado. A gravação é atômica (`.tmp` + `fsync` + rename).

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
- [x] Etapa 2 — formato de projeto `.ncproj` (novo/abrir/salvar/salvar como, atalhos, aviso de
      alterações não salvas)
- [x] Etapa 3 — importação (diálogo e arrastar-e-soltar) + ffprobe + biblioteca com miniaturas
- [x] Etapa 4 — modelo da timeline (adicionar, mover, cortar, dividir, excluir, desfazer/refazer);
      clipes exibidos na timeline, duplo clique em mídia adiciona ao fim da faixa
- [x] Etapa 5 — interação da timeline: seleção, arrastar entre faixas com encaixe, cortar pelas
      bordas, dividir no playhead, excluir, zoom e rolagem, playhead pela régua
- [x] Etapa 6 — motor de pré-visualização: reprodução sincronizada (Espaço), camadas, áudio,
      velocidade, brilho/contraste por CSS, proxies automáticos
- [x] Etapa 7 — painel de propriedades: volume (com ganho real acima de 100% na pré-visualização),
      velocidade, brilho e contraste
- [ ] Etapa 8 — exportação MP4
- [ ] Etapa 9 — empacotamento com FFmpeg e licenças
