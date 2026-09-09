// src/lib/pdfjsLoader.ts
//
// Caminho único do PDF.js no projeto.
//
// A lib não é dependência de npm: é carregada do cdnjs sob demanda, uma vez por
// sessão. O CSP em netlify.toml já libera cdnjs.cloudflare.com em script-src,
// worker-src e connect-src exatamente por causa disso — não troque o host sem
// mexer no CSP, porque a falha é silenciosa (o script simplesmente não carrega).
//
// Existe porque o carregador estava inline em WCICompanionEntry.tsx e um segundo
// consumidor apareceu (leitura de contracheque em lote). O cofre já registra a
// duplicação de scheduleHelpers como dívida do mesmo tipo; esta não nasce assim.

/** Versão fixada. Atualizar aqui muda os dois consumidores de uma vez. */
const PDFJS_VERSION = '3.11.174';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

/** Um fragmento de texto com a posição horizontal em que foi desenhado. */
export interface PdfTextPart {
  /** Coordenada X do PDF (pontos, origem à esquerda) */
  x: number;
  text: string;
}

/**
 * Uma linha visual da página.
 *
 * As posições ficam preservadas porque em documento tabular o texto sozinho não
 * basta: num contracheque, o mesmo `329,58` é vencimento ou desconto só pela
 * coluna em que está. Ver `resolveColumns` em payslipParser.ts.
 */
export interface PdfTextLine {
  /** Coordenada Y do PDF (cresce para cima) */
  y: number;
  parts: PdfTextPart[];
  /** Os fragmentos já unidos, da esquerda para a direita */
  text: string;
}

/** Página de um PDF já rasterizada, com o texto extraído quando existe. */
export interface PdfPage {
  /** 1-indexado, como o PDF.js */
  pageNumber: number;
  /** `data:image/jpeg;base64,...` — serve de miniatura e de página do PDF final */
  jpegDataUrl: string;
  /** Texto da camada de texto, uma linha visual por linha. Vazio em PDF escaneado. */
  text: string;
  /** As mesmas linhas, com as coordenadas de cada fragmento. */
  lines: PdfTextLine[];
  width: number;
  height: number;
}

export interface RenderPdfOptions {
  /** Escala do render. 2 dá legibilidade de impressão; 1.5 é suficiente para tela. */
  scale?: number;
  /** Qualidade do JPEG (0-1). */
  quality?: number;
  /** Teto de páginas processadas. Sem teto, um lote grande travaria a aba. */
  maxPages?: number;
}

let loadPromise: Promise<any> | null = null;

/**
 * Carrega o PDF.js do CDN e devolve o `pdfjsLib` global.
 *
 * A promise é memoizada, não só o resultado: duas chamadas simultâneas (o caso
 * real, com vários arquivos soltos na dropzone ao mesmo tempo) compartilham o
 * mesmo `<script>` em vez de injetar dois.
 */
export function loadPdfJs(): Promise<any> {
  const existing = (window as any).pdfjsLib;
  if (existing) return Promise.resolve(existing);

  if (!loadPromise) {
    loadPromise = new Promise<any>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${PDFJS_BASE}/pdf.min.js`;
      script.onload = () => {
        const lib = (window as any).pdfjsLib;
        if (!lib) {
          reject(new Error('PDF.js carregou mas não expôs pdfjsLib'));
          return;
        }
        lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
        resolve(lib);
      };
      script.onerror = () => {
        // Uma falha aqui não pode ficar memoizada, senão a próxima tentativa
        // devolve o mesmo erro sem tentar de novo.
        loadPromise = null;
        reject(new Error('Falha ao carregar PDF.js'));
      };
      document.head.appendChild(script);
    });
  }

  return loadPromise;
}

/**
 * Rasteriza cada página de um PDF em JPEG e extrai o texto da camada de texto.
 *
 * O texto vem de `getTextContent()`, que devolve os itens na ordem do arquivo,
 * sem noção de linha. Aqui eles são reagrupados por coordenada Y (com tolerância
 * de 2pt) para que cada linha visual do contracheque saia como uma linha de
 * texto — sem isso, o parser não consegue distinguir uma verba da seguinte.
 */
export async function renderPdfPages(
  file: File | Blob,
  options: RenderPdfOptions = {},
): Promise<PdfPage[]> {
  const { scale = 2, quality = 0.9, maxPages = 200 } = options;

  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: PdfPage[] = [];
  const total = Math.min(pdf.numPages, maxPages);

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível neste navegador');

    // Fundo branco explícito: o canvas nasce transparente e o JPEG não tem alfa,
    // então sem isto a página sai com fundo preto.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    let lines: PdfTextLine[] = [];
    try {
      const content = await page.getTextContent();
      lines = groupTextItemsIntoLines(content.items);
    } catch {
      // PDF sem camada de texto (escaneado): segue sem texto, e a tela de
      // conciliação cai em atribuição manual.
      lines = [];
    }

    pages.push({
      pageNumber: i,
      jpegDataUrl: canvas.toDataURL('image/jpeg', quality),
      text: lines.map(l => l.text).join('\n'),
      lines,
      width: canvas.width,
      height: canvas.height,
    });
  }

  return pages;
}

/** Tolerância vertical, em pontos, para considerar dois itens na mesma linha. */
const LINE_TOLERANCE = 2;

/**
 * Reagrupa os itens de texto do PDF.js em linhas visuais.
 *
 * `item.transform` é a matriz de transformação; os índices 4 e 5 são X e Y.
 * Ordena por Y descendente (o eixo do PDF cresce para cima) e, dentro da linha,
 * por X, o que preserva a ordem das colunas do contracheque.
 */
function groupTextItemsIntoLines(items: any[]): PdfTextLine[] {
  const positioned = items
    .filter(it => typeof it?.str === 'string' && it.str.trim().length > 0)
    .map(it => ({
      text: it.str as string,
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0,
    }));

  if (positioned.length === 0) return [];

  const grouped: PdfTextLine[] = [];

  for (const item of positioned) {
    const line = grouped.find(l => Math.abs(l.y - item.y) <= LINE_TOLERANCE);
    if (line) line.parts.push({ x: item.x, text: item.text });
    else grouped.push({ y: item.y, parts: [{ x: item.x, text: item.text }], text: '' });
  }

  return grouped
    .sort((a, b) => b.y - a.y)
    .map(l => {
      l.parts.sort((a, b) => a.x - b.x);
      l.text = l.parts
        .map(p => p.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return l;
    })
    .filter(l => l.text.length > 0);
}

/**
 * Normaliza uma imagem solta (JPG/PNG do celular) para o mesmo formato de saída
 * de `renderPdfPages`, para as duas origens seguirem o mesmo caminho depois.
 *
 * Sem camada de texto, então `text` sai vazio de propósito.
 */
export async function imageToPdfPage(
  file: File,
  options: { maxWidth?: number; quality?: number } = {},
): Promise<PdfPage> {
  const { maxWidth = 1600, quality = 0.9 } = options;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    reader.readAsDataURL(file);
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Arquivo de imagem inválido'));
    img.src = dataUrl;
  });

  const factor = img.width > maxWidth ? maxWidth / img.width : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * factor);
  canvas.height = Math.round(img.height * factor);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível neste navegador');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return {
    pageNumber: 1,
    jpegDataUrl: canvas.toDataURL('image/jpeg', quality),
    text: '',
    lines: [],
    width: canvas.width,
    height: canvas.height,
  };
}
