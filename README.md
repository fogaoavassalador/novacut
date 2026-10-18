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

- `e2e-export.mjs`: diálogo de exportação, encoders detectados, MP4 conferido com `ffprobe`
  (codec, resolução, fps, duração) e cancelamento no meio sem deixar arquivos.

O build de teste vai para `src-tauri/target-e2e`, para não sobrescrever o `novacut.exe` de uma
janela em uso:

```powershell
npm run samples
npm run dev                                   # em outro terminal
$env:CARGO_TARGET_DIR="src-tauri\target-e2e"; cargo build --manifest-path src-tauri/Cargo.toml; Remove-Item Env:CARGO_TARGET_DIR
$env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\novacut-e2e-webview"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9334 --remote-debugging-address=127.0.0.1"
src-tauri\target-e2e\debug\novacut.exe samples\e2e.ncproj
$env:CDP_PORT="9334"
node scripts/e2e-timeline.mjs
node scripts/e2e-preview.mjs
node scripts/e2e-properties.mjs
node scripts/e2e-export.mjs
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

## Exportação (MP4)

`Exportar` (ou `Ctrl+E`) abre o diálogo: arquivo, resolução (do projeto ou reduzida na mesma
proporção), codificador e qualidade (taxa de bits proporcional à área do quadro).

- `core/export/ffmpegArgs.ts` gera a linha de comando a partir do projeto, com as **mesmas regras
  da pré-visualização**: camadas de V1 para cima, mídia ajustada e centralizada, brilho/contraste
  via `lutrgb` (mesma fórmula do CSS), velocidade (`setpts` + cadeia de `atempo`), volume e mix de
  áudio sem normalização. Cada clipe é uma entrada com `-ss/-t`; caminhos nunca entram no filtro.
- Só são oferecidos codificadores que **funcionam nesta máquina** (cada um codifica um vídeo de teste
  minúsculo na primeira abertura), em ordem de preferência: GPU AMD/NVIDIA/Intel, Media Foundation,
  OpenH264.
- O backend (`export.rs`) roda o FFmpeg sem janela de console, lê `-progress pipe:1` (barra, velocidade
  e tempo restante) e grava num arquivo temporário ao lado do destino: o MP4 final só aparece se
  tudo der certo. Cancelar ou falhar apaga o temporário.
- Um teste de integração exporta um projeto sintético de verdade e confere pixels (camadas,
  centralização, brilho/contraste, velocidade) e níveis de áudio (silêncio, posição, +6 dB a 200%).

## Empacotamento (instalador Windows)

```powershell
npm run package        # = tauri build --bundles nsis --config src-tauri/tauri.package.conf.json
```

Resultado: `src-tauri/target/release/bundle/nsis/NovaCut_<versão>_x64-setup.exe` (~45 MiB). Na
primeira vez, a CLI do Tauri baixa as ferramentas do NSIS (`nsis-3.13.zip`, ~2,3 MB, e
`nsis_tauri_utils.dll`, ~34 KB, de `github.com/tauri-apps`, conferidos por SHA-1) para
`%LOCALAPPDATA%\tauri`.

A configuração base inclui `ffmpeg/*` e `licenses/*` (sempre casam, por causa do `.gitkeep`, então
um clone novo compila sem o FFmpeg preparado); o patch `tauri.package.conf.json` troca esses
padrões por `*.exe`, `*.dll`, `*.json` e `*.txt` só no empacotamento.

O `beforeBuildCommand` roda `npm run build`, `npm run prepare-ffmpeg` e `npm run notices`:

- **`prepare-ffmpeg`** copia `ffmpeg.exe`, `ffprobe.exe` e as DLLs do build LGPL *shared* (origem:
  `NOVACUT_FFMPEG_SOURCE` ou o `ffmpeg` do PATH) para `src-tauri/ffmpeg/`, grava um manifesto com
  SHA-256 e **recusa builds GPL/nonfree**. As DLLs separadas permitem trocar as bibliotecas (LGPL).
- **`notices`** gera em `src-tauri/licenses/`: `THIRD_PARTY_NOTICES.txt` (dependências JS de
  produção e crates Rust do executável, com textos de licença), `FFMPEG-NOTICE.txt` (versão,
  configuração, SHA-256 e onde obter o código-fonte), `FFMPEG-THIRD-PARTY.txt` (licenças das
  bibliotecas externas do FFmpeg), `FFmpeg-LICENSE.txt` (LGPLv3) e `GPL-3.0.txt` (exigida pela
  LGPLv3; cópia oficial conferida por SHA-256).
- **`third_party_licenses/`** guarda, versionados, os textos de licença que não vêm nos pacotes: as
  79 bibliotecas compiladas no FFmpeg (as 43 de `--enable-lib*`, as dependências delas e o código
  que embutem, como glslang e highway), cada uma no commit dos scripts do BtbN FFmpeg-Builds usado
  pelo build, e 5 crates Rust publicados sem o arquivo. `sources.json` registra origem, commit e
  SHA-256 de cada texto; o `notices` confere os hashes e avisa se faltar texto para alguma opção
  `--enable-` do FFmpeg. Ao trocar o FFmpeg, atualize os commits em `sources.json` pelos
  `scripts.d` do BtbN e rode `npm run fetch-licenses`, que baixa da internet só os textos ausentes.
- O app procura o FFmpeg nesta ordem: `NOVACUT_FFMPEG_DIR` → pasta `ffmpeg` instalada com o app →
  PATH. A barra de status mostra a origem.
- Instalador NSIS por usuário (sem administrador), em português do Brasil; ícone próprio gerado de
  `src-tauri/app-icon.svg` (`npx tauri icon src-tauri/app-icon.svg`).

### Pendências antes de distribuir publicamente

`npm run notices` lista como `PENDENTE`:

- **FFTW3 (GPL) dentro do FFmpeg "LGPL"**: o BtbN compila o chromaprint com `-DFFT_LIB=fftw3`, e o
  FFTW3 (GPLv2+) vai ligado em `avformat-62.dll`. Por isso o FFmpeg embutido não é só LGPLv3. Falta
  decidir: distribuir os binários do FFmpeg sob a GPLv3 ou usar um build sem chromaprint;
- os crates Rust compilados no rav1e (o `Cargo.lock` do commit), cujos textos ainda não estão em
  `third_party_licenses/`.

Fora do `notices`:

- o nv-codec-headers (`--enable-ffnvcodec`) não tem arquivo de licença; o texto MIT está só nos
  comentários dos cabeçalhos;
- a licença do próprio NovaCut (ainda não definida);
- revisão jurídica sobre patentes de H.264/AAC e sobre a licença de patentes do OpenH264;
- assinatura de código: o instalador não é assinado, então o Windows SmartScreen avisa ao executá-lo;
- o identificador `com.novacut.app` termina em `.app` (o Tauri avisa: conflita só no macOS). Trocá-lo
  muda a pasta de dados do app (cache de proxies), então convém decidir antes da primeira versão.

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
| Exportar | `Ctrl+E` |

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
- [x] Etapa 8 — exportação MP4: gerador de argumentos, encoders testados, progresso, cancelamento
- [x] Etapa 9 — empacotamento: instalador NSIS por usuário com FFmpeg embutido, avisos de licença e
      ícone próprio; build de release validado sem FFmpeg no PATH (ver pendências de distribuição)
