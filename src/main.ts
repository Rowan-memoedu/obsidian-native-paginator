import {
  Component,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
} from "obsidian";
import {
  PageMode,
  calculateBookGeometry,
  calculateTotalPages,
  clampPage,
  fractionFromPage,
  pageFromFraction,
} from "./layout";
import {
  DEFAULT_FASTREAD_ALGORITHM,
  DEFAULT_FASTREAD_COMMON_WORDS,
  collectFastReadTextNodes,
  findFastReadMatches,
  parseFastReadAlgorithm,
  withFastReadRestRatio,
} from "./fastread";
import { moveReadingFileState } from "./file-state";
import { scheduleCooperativeTask } from "./scheduler";

type PageTint = "none" | "sepia" | "cream" | "gray" | "night";

interface NativePaginatorSettings {
  schemaVersion: number;
  enabledFiles: Record<string, boolean>;
  positions: Record<string, number>;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  pageMode: PageMode;
  maxPageWidth: number;
  columnGap: number;
  verticalPadding: number;
  tint: PageTint;
  animate: boolean;
  wheelPaging: boolean;
  edgeClickPaging: boolean;
  fastReadEnabled: boolean;
  fastReadAlgorithm: string;
  fastReadExcludeCommonWords: boolean;
  fastReadCommonWords: string;
  fastReadDimRest: boolean;
  fastReadFontWeight: number;
}

const SETTINGS_SCHEMA = 3;
const DEFAULT_SETTINGS: NativePaginatorSettings = {
  schemaVersion: SETTINGS_SCHEMA,
  enabledFiles: {},
  positions: {},
  fontFamily: "STSong, 华文宋体, SimSun, serif",
  fontSize: 1,
  lineHeight: 1.6,
  pageMode: "auto",
  maxPageWidth: 600,
  columnGap: 2.5,
  verticalPadding: 1.4,
  tint: "sepia",
  animate: true,
  wheelPaging: true,
  edgeClickPaging: true,
  fastReadEnabled: true,
  fastReadAlgorithm: DEFAULT_FASTREAD_ALGORITHM,
  fastReadExcludeCommonWords: true,
  fastReadCommonWords: DEFAULT_FASTREAD_COMMON_WORDS,
  fastReadDimRest: false,
  fastReadFontWeight: 600,
};

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "audio",
  "video",
  "iframe",
  ".task-list-item-checkbox",
  ".callout-fold",
  ".footnote-link",
  ".nmp-ui",
].join(",");

function stripFrontmatter(raw: string, endOffset?: number): string {
  const body = typeof endOffset === "number"
    ? raw.slice(endOffset)
    : raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return body.replace(/^\s+/, "");
}

interface FastReadTextJob {
  textNode: Text;
  parent: Element;
  matches: ReturnType<typeof findFastReadMatches>;
}

interface FastReadGlyph {
  backgroundColor: string;
  color: string;
  fontFamily: string;
  fontFeatureSettings: string;
  fontKerning: string;
  fontSize: string;
  fontStretch: string;
  fontStyle: string;
  fontVariant: string;
  fontWeight: string;
  height: number;
  kind: "highlight" | "rest";
  left: number;
  letterSpacing: string;
  text: string;
  top: number;
}

interface FastReadPage {
  decoratedWords: number;
  glyphs: FastReadGlyph[];
}

class PaginationSession {
  private readonly plugin: NativeMarkdownPaginatorPlugin;
  readonly view: MarkdownView;
  private readonly containerEl: HTMLElement;
  private readonly readingEl: HTMLElement;
  private readonly viewportEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly contentEl: HTMLElement;
  private readonly fastReadOverlayEl: HTMLElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly scrubEl: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly progressFillEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly optionsButtonEl: HTMLButtonElement;
  private readonly optionsPanelEl: HTMLElement;
  private readonly cleanupCallbacks: Array<() => void> = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private renderChild: Component | null = null;
  private renderGeneration = 0;
  private measureTimer: number | null = null;
  private measureCancel: (() => void) | null = null;
  private persistTimer: number | null = null;
  private fastReadDrawTimer: number | null = null;
  private fastReadDrawCancel: (() => void) | null = null;
  private fastReadDrawGeneration = 0;
  private fastReadBuildCancel: (() => void) | null = null;
  private fastReadBuildGeneration = 0;
  private fastReadTextJobs: FastReadTextJob[] = [];
  private fastReadPages: FastReadPage[] = [];
  private fastReadPagesReady = false;
  private pageStride = 1;
  private totalPages = 1;
  private currentPage = 0;
  private measured = false;
  private wheelLockedUntil = 0;
  private scrub: { pointerId: number; fraction: number } | null = null;
  private ignoreClickUntil = 0;
  private destroyed = false;

  static create(plugin: NativeMarkdownPaginatorPlugin, view: MarkdownView): PaginationSession | null {
    const readingEl = view.containerEl.querySelector<HTMLElement>(".markdown-reading-view");
    if (!readingEl) return null;
    return new PaginationSession(plugin, view, readingEl);
  }

  private constructor(
    plugin: NativeMarkdownPaginatorPlugin,
    view: MarkdownView,
    readingEl: HTMLElement,
  ) {
    this.plugin = plugin;
    this.view = view;
    this.containerEl = view.containerEl;
    this.readingEl = readingEl;

    const viewport = document.createElement("div");
    viewport.className = "nmp-viewport";
    viewport.dataset.ignoreSwipe = "true";
    viewport.tabIndex = 0;
    viewport.setAttribute("role", "region");
    viewport.setAttribute("aria-roledescription", "paged reader");

    const stage = document.createElement("div");
    stage.className = "nmp-stage";
    const content = document.createElement("div");
    content.className = "nmp-content markdown-rendered";
    stage.appendChild(content);
    const fastReadOverlay = document.createElement("div");
    fastReadOverlay.className = "nmp-fastread-overlay";
    fastReadOverlay.hidden = true;
    viewport.append(stage, fastReadOverlay);

    const previousButton = document.createElement("button");
    previousButton.className = "nmp-nav-button nmp-previous nmp-ui";
    previousButton.type = "button";
    previousButton.setAttribute("aria-label", "上一页");
    previousButton.textContent = "‹";

    const nextButton = document.createElement("button");
    nextButton.className = "nmp-nav-button nmp-next nmp-ui";
    nextButton.type = "button";
    nextButton.setAttribute("aria-label", "下一页");
    nextButton.textContent = "›";

    const statusBar = document.createElement("div");
    statusBar.className = "nmp-statusbar nmp-ui";
    statusBar.setAttribute("aria-live", "polite");
    const scrub = document.createElement("div");
    scrub.className = "nmp-scrub";
    scrub.setAttribute("aria-label", "阅读进度，可拖动跳转");
    const progress = document.createElement("div");
    progress.className = "nmp-progress";
    const progressFill = document.createElement("div");
    progressFill.className = "nmp-progress-fill";
    progress.appendChild(progressFill);
    scrub.appendChild(progress);
    const status = document.createElement("div");
    status.className = "nmp-status-text";
    status.textContent = "1 / 1 · 0%";
    const optionsButton = document.createElement("button");
    optionsButton.className = "nmp-options-button nmp-ui";
    optionsButton.type = "button";
    optionsButton.textContent = "Aa";
    optionsButton.setAttribute("aria-label", "打开阅读插件面板");
    optionsButton.setAttribute("aria-expanded", "false");
    const optionsPanel = document.createElement("div");
    optionsPanel.className = "nmp-options-panel nmp-ui";
    optionsPanel.hidden = true;
    statusBar.append(scrub, status, optionsButton);
    viewport.append(previousButton, nextButton, statusBar, optionsPanel);
    readingEl.appendChild(viewport);

    this.viewportEl = viewport;
    this.stageEl = stage;
    this.contentEl = content;
    this.fastReadOverlayEl = fastReadOverlay;
    this.previousButton = previousButton;
    this.nextButton = nextButton;
    this.scrubEl = scrub;
    this.progressEl = progress;
    this.progressFillEl = progressFill;
    this.statusEl = status;
    this.optionsButtonEl = optionsButton;
    this.optionsPanelEl = optionsPanel;

    this.containerEl.classList.add("nmp-active");
    this.applySettings();

    this.listen(previousButton, "click", (event) => {
      event.stopPropagation();
      this.previous();
    });
    this.listen(nextButton, "click", (event) => {
      event.stopPropagation();
      this.next();
    });
    this.listen(optionsButton, "click", (event) => {
      event.stopPropagation();
      const open = this.optionsPanelEl.hidden;
      this.optionsPanelEl.hidden = !open;
      this.optionsButtonEl.setAttribute("aria-expanded", String(open));
      if (open) this.renderOptionsPanel();
    });
    this.listen(viewport, "wheel", (event) => this.onWheel(event as WheelEvent), { passive: false });
    this.listen(viewport, "click", (event) => this.onViewportClick(event as MouseEvent));
    this.listen(document, "keydown", (event) => this.onKeyDown(event as KeyboardEvent));
    this.listen(this.contentEl.ownerDocument, "visibilitychange", () => {
      if (this.contentEl.ownerDocument.visibilityState !== "hidden") return;
      if (!this.measured) this.scheduleMeasure();
      else this.scheduleFastReadOverlay(0);
    });
    this.setupScrub();

    this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
    this.resizeObserver.observe(viewport);
    this.mutationObserver = new MutationObserver(() => this.scheduleMeasure());
    this.mutationObserver.observe(content, { childList: true, subtree: true, characterData: true });

    void this.renderDocument();
  }

  get filePath(): string | null {
    return this.view.file?.path ?? null;
  }

  isMountedFor(view: MarkdownView): boolean {
    return this.view === view && this.containerEl.isConnected && this.viewportEl.isConnected;
  }

  refreshSettings(): void {
    this.applySettings();
    this.scheduleMeasure();
  }

  reload(): void {
    void this.renderDocument(this.currentFraction());
  }

  refreshFastRead(): void {
    this.applySettings();
    this.rebuildFastReadTextJobs();
    this.rebuildFastReadPages();
    this.scheduleFastReadOverlay(0);
  }

  private async renderDocument(position = this.savedFraction()): Promise<void> {
    const file = this.view.file;
    if (!file || this.destroyed) return;
    const generation = ++this.renderGeneration;
    this.measured = false;

    let raw: string;
    try {
      raw = await this.plugin.app.vault.cachedRead(file);
    } catch (error) {
      console.error("Native Markdown Paginator: unable to read note", error);
      return;
    }
    if (this.destroyed || generation !== this.renderGeneration) return;

    if (this.renderChild) {
      this.plugin.removeChild(this.renderChild);
      this.renderChild = null;
    }
    const renderChild = new Component();
    this.plugin.addChild(renderChild);
    this.renderChild = renderChild;
    this.clearFastReadOverlay();
    this.contentEl.replaceChildren();

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const body = stripFrontmatter(raw, cache?.frontmatterPosition?.end.offset);
    try {
      await MarkdownRenderer.render(this.plugin.app, body, this.contentEl, file.path, renderChild);
    } catch (error) {
      console.error("Native Markdown Paginator: Markdown render failed", error);
    }
    if (this.destroyed || generation !== this.renderGeneration) return;

    const firstElements = Array.from(this.contentEl.children).slice(0, 4);
    if (!firstElements.some((element) => element.tagName === "H1")) {
      const title = document.createElement("h1");
      title.className = "nmp-title";
      title.textContent = file.basename;
      this.contentEl.prepend(title);
    }

    this.contentEl.dataset.fastreadWords = "0";
    this.rebuildFastReadTextJobs();

    this.contentEl.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      if (!image.complete) this.listen(image, "load", () => this.scheduleMeasure(), { once: true });
    });

    const measureRendered = (): void => {
      if (!this.destroyed && generation === this.renderGeneration) this.measure(position);
    };
    if (this.contentEl.ownerDocument.visibilityState === "hidden") {
      scheduleCooperativeTask(measureRendered);
    } else {
      window.requestAnimationFrame(measureRendered);
    }
  }

  private savedFraction(): number {
    const path = this.filePath;
    return path ? this.plugin.settings.positions[path] ?? 0 : 0;
  }

  private currentFraction(): number {
    return this.measured ? fractionFromPage(this.currentPage, this.totalPages) : this.savedFraction();
  }

  private applySettings(): void {
    const settings = this.plugin.settings;
    this.viewportEl.classList.remove(
      "nmp-tint-sepia",
      "nmp-tint-cream",
      "nmp-tint-gray",
      "nmp-tint-night",
    );
    if (settings.tint !== "none") this.viewportEl.classList.add(`nmp-tint-${settings.tint}`);
    this.contentEl.style.setProperty("--nmp-font-family", settings.fontFamily);
    this.contentEl.style.setProperty("--nmp-font-size", `${settings.fontSize}em`);
    this.contentEl.style.setProperty("--nmp-line-height", String(settings.lineHeight));
    this.contentEl.style.setProperty("--nmp-column-gap", `${settings.columnGap}em`);
    this.contentEl.style.transition = settings.animate ? "transform 0.2s ease" : "none";
  }

  private renderOptionsPanel(): void {
    const panel = this.optionsPanelEl;
    const settings = this.plugin.settings;
    panel.replaceChildren();

    const header = document.createElement("div");
    header.className = "nmp-options-header";
    const title = document.createElement("strong");
    title.textContent = "阅读插件面板";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "nmp-options-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭阅读插件面板");
    close.addEventListener("click", () => {
      panel.hidden = true;
      this.optionsButtonEl.setAttribute("aria-expanded", "false");
    });
    header.append(title, close);
    panel.appendChild(header);

    const heading = (text: string): void => {
      const element = document.createElement("div");
      element.className = "nmp-options-heading";
      element.textContent = text;
      panel.appendChild(element);
    };
    const row = (labelText: string, control: HTMLElement): void => {
      const label = document.createElement("label");
      label.className = "nmp-options-row";
      const text = document.createElement("span");
      text.textContent = labelText;
      label.append(text, control);
      panel.appendChild(label);
    };
    const toggle = (checked: boolean, onChange: (value: boolean) => void): HTMLInputElement => {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      input.addEventListener("change", () => onChange(input.checked));
      return input;
    };
    const saveFastRead = async (): Promise<void> => {
      await this.plugin.saveSettings();
      this.plugin.refreshFastReadSessions();
      this.renderOptionsPanel();
    };

    heading("Fastread");
    row("启用视觉锚点", toggle(settings.fastReadEnabled, (value) => {
      settings.fastReadEnabled = value;
      void saveFastRead();
    }));

    const ratio = document.createElement("select");
    const parsed = parseFastReadAlgorithm(settings.fastReadAlgorithm);
    const currentRatio = settings.fastReadEnabled ? parsed.restRatio : 0;
    for (const value of [0, 0.35, 0.4, 0.45, 0.5]) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = value === 0 ? "关闭" : String(value);
      option.selected = value === currentRatio;
      ratio.appendChild(option);
    }
    ratio.addEventListener("change", () => {
      const value = Number(ratio.value);
      settings.fastReadEnabled = value > 0;
      if (value > 0) settings.fastReadAlgorithm = withFastReadRestRatio(settings.fastReadAlgorithm, value);
      void saveFastRead();
    });
    row("强调比例", ratio);

    row("跳过英文高频词", toggle(settings.fastReadExcludeCommonWords, (value) => {
      settings.fastReadExcludeCommonWords = value;
      void saveFastRead();
    }));
    row("淡化单词后半段", toggle(settings.fastReadDimRest, (value) => {
      settings.fastReadDimRest = value;
      void saveFastRead();
    }));

    const weight = document.createElement("select");
    for (const value of [500, 600, 700]) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = value === 600 ? "600（推荐）" : String(value);
      option.selected = value === settings.fastReadFontWeight;
      weight.appendChild(option);
    }
    weight.addEventListener("change", () => {
      settings.fastReadFontWeight = Number(weight.value);
      void saveFastRead();
    });
    row("强调字重", weight);

    const details = document.createElement("details");
    details.className = "nmp-options-advanced";
    const summary = document.createElement("summary");
    summary.textContent = "高级 Fastread 设置";
    const algorithm = document.createElement("input");
    algorithm.type = "text";
    algorithm.value = settings.fastReadAlgorithm;
    algorithm.setAttribute("aria-label", "Fastread algorithm string");
    algorithm.addEventListener("change", () => {
      settings.fastReadAlgorithm = algorithm.value.trim() || DEFAULT_FASTREAD_ALGORITHM;
      void saveFastRead();
    });
    const commonWords = document.createElement("textarea");
    commonWords.rows = 3;
    commonWords.value = settings.fastReadCommonWords;
    commonWords.setAttribute("aria-label", "英文高频词跳过表");
    commonWords.addEventListener("change", () => {
      settings.fastReadCommonWords = commonWords.value.trim();
      void saveFastRead();
    });
    details.append(summary, algorithm, commonWords);
    panel.appendChild(details);

    heading("翻页");
    row("翻页动画", toggle(settings.animate, (value) => {
      settings.animate = value;
      void this.plugin.saveSettings().then(() => this.plugin.refreshSessions());
    }));
    row("滚轮翻页", toggle(settings.wheelPaging, (value) => {
      settings.wheelPaging = value;
      void this.plugin.saveSettings();
    }));
    row("点击页面边缘翻页", toggle(settings.edgeClickPaging, (value) => {
      settings.edgeClickPaging = value;
      void this.plugin.saveSettings();
    }));
  }

  private scheduleMeasure(): void {
    if (this.destroyed) return;
    if (this.measureTimer !== null) window.clearTimeout(this.measureTimer);
    this.measureCancel?.();
    this.measureCancel = null;
    if (this.contentEl.ownerDocument.visibilityState === "hidden") {
      this.measureTimer = null;
      this.measureCancel = scheduleCooperativeTask(() => {
        this.measureCancel = null;
        this.measure();
      });
      return;
    }
    this.measureTimer = window.setTimeout(() => {
      this.measureTimer = null;
      window.requestAnimationFrame(() => this.measure());
    }, 150);
  }

  private measure(position = this.currentFraction()): void {
    if (this.destroyed || !this.contentEl.isConnected) return;
    this.clearFastReadOverlay();
    const viewportWidth = this.viewportEl.clientWidth;
    if (!viewportWidth) return;

    this.applySettings();
    const settings = this.plugin.settings;
    const rootSize = parseFloat(getComputedStyle(this.viewportEl).fontSize) || 16;
    const gap = parseFloat(getComputedStyle(this.contentEl).columnGap)
      || settings.columnGap * rootSize * settings.fontSize;
    const geometry = calculateBookGeometry(
      viewportWidth,
      gap,
      settings.pageMode,
      settings.maxPageWidth,
      Platform.isDesktop,
    );

    this.stageEl.style.width = `${geometry.stageWidth}px`;
    this.stageEl.classList.toggle("nmp-two-page", geometry.pageCount === 2);
    this.contentEl.style.width = `${geometry.stageWidth}px`;
    this.contentEl.style.columnWidth = `${geometry.pageWidth}px`;
    this.pageStride = geometry.pageStride;

    const statusHeight = this.statusEl.parentElement?.offsetHeight ?? 0;
    const pageEm = rootSize * settings.fontSize;
    const minimumBottom = pageEm > 0 ? (statusHeight + 4) / pageEm : 0;
    this.contentEl.style.paddingTop = `${settings.verticalPadding}em`;
    this.contentEl.style.paddingBottom = `${Math.max(settings.verticalPadding + 0.6, minimumBottom)}em`;

    const scrollWidth = this.contentEl.scrollWidth;
    this.totalPages = calculateTotalPages(scrollWidth, this.pageStride, gap);
    this.currentPage = pageFromFraction(position, this.totalPages);
    this.measured = true;

    this.contentEl.style.transition = "none";
    this.applyTransform();
    void this.contentEl.offsetWidth;
    this.contentEl.style.transition = settings.animate ? "transform 0.2s ease" : "none";
    this.updateControls();
    this.rebuildFastReadPages();
    this.scheduleFastReadOverlay(0);
  }

  private clearFastReadOverlay(): void {
    if (this.fastReadDrawTimer !== null) window.clearTimeout(this.fastReadDrawTimer);
    this.fastReadDrawTimer = null;
    this.fastReadDrawCancel?.();
    this.fastReadDrawCancel = null;
    this.fastReadDrawGeneration++;
    this.fastReadOverlayEl.replaceChildren();
    this.fastReadOverlayEl.hidden = true;
    this.contentEl.dataset.fastreadWords = "0";
  }

  private scheduleFastReadOverlay(delay: number): void {
    this.clearFastReadOverlay();
    if (!this.plugin.settings.fastReadEnabled || !this.measured || this.destroyed) return;
    const generation = this.fastReadDrawGeneration;
    const draw = (): void => {
      this.fastReadDrawTimer = null;
      this.fastReadDrawCancel = null;
      if (!this.destroyed && generation === this.fastReadDrawGeneration) {
        this.drawFastReadOverlay();
      }
    };
    if (delay <= 0 || this.contentEl.ownerDocument.visibilityState === "hidden") {
      this.fastReadDrawCancel = scheduleCooperativeTask(draw);
    } else {
      this.fastReadDrawTimer = window.setTimeout(draw, delay);
    }
  }

  private rebuildFastReadTextJobs(): void {
    this.fastReadTextJobs = [];
    if (!this.plugin.settings.fastReadEnabled) return;
    const settings = this.plugin.settings;
    const options = {
      algorithm: settings.fastReadAlgorithm,
      excludeCommonWords: settings.fastReadExcludeCommonWords,
      commonWords: settings.fastReadCommonWords,
      dimRest: settings.fastReadDimRest,
    };
    for (const textNode of collectFastReadTextNodes(this.contentEl)) {
      const parent = textNode.parentElement;
      if (!parent || parent === this.contentEl) continue;
      const matches = findFastReadMatches(textNode.nodeValue ?? "", options);
      if (matches.length > 0) this.fastReadTextJobs.push({ textNode, parent, matches });
    }
  }

  private rebuildFastReadPages(): void {
    this.fastReadBuildCancel?.();
    this.fastReadBuildCancel = null;
    const generation = ++this.fastReadBuildGeneration;
    this.fastReadPages = [];
    this.fastReadPagesReady = false;
    if (!this.plugin.settings.fastReadEnabled || !this.measured || this.destroyed) return;

    const documentRef = this.contentEl.ownerDocument;
    const stageRect = this.stageEl.getBoundingClientRect();
    const contentRect = this.contentEl.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0 || this.pageStride <= 0) return;

    const settings = this.plugin.settings;
    const background = getComputedStyle(this.viewportEl).backgroundColor;
    const pages = Array.from({ length: this.totalPages }, (): FastReadPage => ({
      decoratedWords: 0,
      glyphs: [],
    }));
    const styleCache = new Map<Element, CSSStyleDeclaration>();
    const jobs = this.fastReadTextJobs.flatMap(({ textNode, parent, matches }) => (
      matches.map((match) => ({ textNode, parent, match }))
    ));
    let cursor = 0;

    const pagePosition = (rect: DOMRect): { page: number; left: number; top: number } | null => {
      const absoluteLeft = rect.left - contentRect.left;
      const page = Math.floor((absoluteLeft + 0.5) / this.pageStride);
      const left = absoluteLeft - page * this.pageStride;
      const top = rect.top - stageRect.top;
      if (
        page < 0
        || page >= pages.length
        || left < -0.5
        || left >= stageRect.width
        || top + rect.height <= 0
        || top >= stageRect.height
      ) return null;
      return { page, left, top };
    };
    const glyphFrom = (
      rect: DOMRect,
      position: { left: number; top: number },
      text: string,
      style: CSSStyleDeclaration,
      kind: "highlight" | "rest",
    ): FastReadGlyph => ({
      backgroundColor: kind === "highlight" ? "transparent" : background,
      color: kind === "highlight"
        ? style.color
        : `color-mix(in srgb, ${style.color} 70%, ${background})`,
      fontFamily: style.fontFamily,
      fontFeatureSettings: style.fontFeatureSettings,
      fontKerning: style.fontKerning,
      fontSize: style.fontSize,
      fontStretch: style.fontStretch,
      fontStyle: kind === "highlight" ? "normal" : style.fontStyle,
      fontVariant: style.fontVariant,
      fontWeight: kind === "highlight" ? String(settings.fastReadFontWeight) : style.fontWeight,
      height: rect.height,
      kind,
      left: position.left,
      letterSpacing: style.letterSpacing,
      text,
      top: position.top,
    });
    const buildBatch = (): void => {
      if (this.destroyed || generation !== this.fastReadBuildGeneration) return;
      const deadline = performance.now() + 8;
      while (cursor < jobs.length && performance.now() < deadline) {
        const job = jobs[cursor++];
        if (!job) break;
        const { textNode, parent, match } = job;
        const style = styleCache.get(parent) ?? getComputedStyle(parent);
        styleCache.set(parent, style);
        const highlightRange = documentRef.createRange();
        highlightRange.setStart(textNode, match.start);
        highlightRange.setEnd(textNode, match.highlightEnd);
        const highlightRect = Array.from(highlightRange.getClientRects())[0];
        if (!highlightRect) continue;
        const highlightPosition = pagePosition(highlightRect);
        if (!highlightPosition) continue;
        const page = pages[highlightPosition.page];
        if (!page) continue;
        page.glyphs.push(glyphFrom(
          highlightRect,
          highlightPosition,
          match.split.highlight,
          style,
          "highlight",
        ));
        if (match.split.rest) {
          const restRange = documentRef.createRange();
          restRange.setStart(textNode, match.highlightEnd);
          restRange.setEnd(textNode, match.end);
          const restRect = Array.from(restRange.getClientRects())[0];
          if (restRect) {
            const restPosition = pagePosition(restRect);
            if (restPosition?.page === highlightPosition.page) {
              page.glyphs.push(glyphFrom(
                restRect,
                restPosition,
                match.split.rest,
                style,
                "rest",
              ));
            }
          }
        }
        page.decoratedWords++;
      }
      if (cursor < jobs.length) {
        this.fastReadBuildCancel = scheduleCooperativeTask(() => {
          this.fastReadBuildCancel = null;
          buildBatch();
        });
        return;
      }
      if (this.destroyed || generation !== this.fastReadBuildGeneration) return;
      this.fastReadPages = pages;
      this.fastReadPagesReady = true;
      if (this.fastReadDrawTimer === null && this.fastReadDrawCancel === null) {
        this.scheduleFastReadOverlay(0);
      }
    };
    buildBatch();
  }

  private drawFastReadOverlay(): void {
    const overlay = this.fastReadOverlayEl;
    if (!this.plugin.settings.fastReadEnabled || !this.fastReadPagesReady) return;
    const stageRect = this.stageEl.getBoundingClientRect();
    const viewportRect = this.viewportEl.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0) return;

    overlay.style.left = `${stageRect.left - viewportRect.left}px`;
    overlay.style.top = `${stageRect.top - viewportRect.top}px`;
    overlay.style.width = `${stageRect.width}px`;
    overlay.style.height = `${stageRect.height}px`;

    const page = this.fastReadPages[this.currentPage];
    if (!page) return;
    const fragment = this.contentEl.ownerDocument.createDocumentFragment();
    for (const data of page.glyphs) {
      if (data.kind === "rest" && !this.plugin.settings.fastReadDimRest) continue;
      const glyph = this.contentEl.ownerDocument.createElement("span");
      glyph.className = `nmp-fastread-glyph is-${data.kind}`;
      glyph.textContent = data.text;
      glyph.style.left = `${data.left}px`;
      glyph.style.top = `${data.top}px`;
      glyph.style.height = `${data.height}px`;
      glyph.style.color = data.color;
      glyph.style.backgroundColor = data.backgroundColor;
      glyph.style.fontFamily = data.fontFamily;
      glyph.style.fontSize = data.fontSize;
      glyph.style.fontWeight = data.kind === "highlight"
        ? String(this.plugin.settings.fastReadFontWeight)
        : data.fontWeight;
      glyph.style.fontStyle = data.fontStyle;
      glyph.style.fontVariant = data.fontVariant;
      glyph.style.fontStretch = data.fontStretch;
      glyph.style.fontFeatureSettings = data.fontFeatureSettings;
      glyph.style.fontKerning = data.fontKerning;
      glyph.style.letterSpacing = data.letterSpacing;
      glyph.style.lineHeight = `${data.height}px`;
      fragment.appendChild(glyph);
    }
    overlay.replaceChildren(fragment);
    overlay.hidden = false;
    this.contentEl.dataset.fastreadWords = String(page.decoratedWords);
  }

  private applyTransform(extra = 0): void {
    this.contentEl.style.transform = `translateX(${-this.currentPage * this.pageStride + extra}px)`;
  }

  private goToPage(page: number, persist = true): void {
    const nextPage = clampPage(page, this.totalPages);
    this.clearFastReadOverlay();
    this.currentPage = nextPage;
    this.applyTransform();
    this.updateControls();
    this.scheduleFastReadOverlay(this.plugin.settings.animate ? 210 : 0);
    if (persist) this.schedulePersist();
  }

  previous(): void {
    this.goToPage(this.currentPage - 1);
  }

  next(): void {
    this.goToPage(this.currentPage + 1);
  }

  private updateControls(previewFraction?: number): void {
    const fraction = previewFraction ?? fractionFromPage(this.currentPage, this.totalPages);
    const percent = Math.round(fraction * 100);
    this.progressFillEl.style.transform = `scaleX(${fraction})`;
    this.statusEl.textContent = previewFraction === undefined
      ? `${this.currentPage + 1} / ${this.totalPages} · ${percent}%`
      : `${percent}%`;
    this.previousButton.disabled = this.currentPage <= 0;
    this.nextButton.disabled = this.currentPage >= this.totalPages - 1;
  }

  private setupScrub(): void {
    const fractionAt = (clientX: number): number => {
      const rect = this.progressEl.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    this.listen(this.scrubEl, "pointerdown", (rawEvent) => {
      const event = rawEvent as PointerEvent;
      if (event.button > 0) return;
      event.preventDefault();
      event.stopPropagation();
      const fraction = fractionAt(event.clientX);
      this.scrub = { pointerId: event.pointerId, fraction };
      this.scrubEl.classList.add("is-scrubbing");
      try {
        this.scrubEl.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is an enhancement; drag still works without it.
      }
      this.updateControls(fraction);
    });

    this.listen(this.scrubEl, "pointermove", (rawEvent) => {
      const event = rawEvent as PointerEvent;
      if (!this.scrub || event.pointerId !== this.scrub.pointerId) return;
      event.preventDefault();
      this.scrub.fraction = fractionAt(event.clientX);
      this.updateControls(this.scrub.fraction);
    });

    const finish = (rawEvent: Event): void => {
      const event = rawEvent as PointerEvent;
      if (!this.scrub || event.pointerId !== this.scrub.pointerId) return;
      const fraction = this.scrub.fraction;
      this.scrub = null;
      this.scrubEl.classList.remove("is-scrubbing");
      this.ignoreClickUntil = Date.now() + 400;
      this.goToPage(pageFromFraction(fraction, this.totalPages));
    };
    this.listen(this.scrubEl, "pointerup", finish);
    this.listen(this.scrubEl, "pointercancel", finish);
  }

  private onWheel(event: WheelEvent): void {
    if (!this.plugin.settings.wheelPaging) return;
    if (Math.abs(event.deltaY) < 10 && Math.abs(event.deltaX) < 10) return;
    event.preventDefault();
    const now = Date.now();
    if (now < this.wheelLockedUntil) return;
    this.wheelLockedUntil = now + 260;
    if (event.deltaY > 0 || event.deltaX > 0) this.next();
    else this.previous();
  }

  private onViewportClick(event: MouseEvent): void {
    if (!this.plugin.settings.edgeClickPaging || Date.now() < this.ignoreClickUntil) return;
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return;
    const selection = this.viewportEl.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed) return;
    const rect = this.viewportEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < rect.width * 0.3) this.previous();
    else if (x > rect.width * 0.7) this.next();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.view.containerEl.contains(document.activeElement) && this.plugin.app.workspace.activeLeaf !== this.view.leaf) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return;
    if (event.key === "ArrowRight" || event.key === "PageDown" || (event.key === " " && !event.shiftKey)) {
      event.preventDefault();
      this.next();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp" || (event.key === " " && event.shiftKey)) {
      event.preventDefault();
      this.previous();
    } else if (event.key === "Home") {
      event.preventDefault();
      this.goToPage(0);
    } else if (event.key === "End") {
      event.preventDefault();
      this.goToPage(this.totalPages - 1);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      const path = this.filePath;
      if (path && this.measured) {
        this.plugin.setPosition(path, fractionFromPage(this.currentPage, this.totalPages));
      }
    }, 350);
  }

  private listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this.cleanupCallbacks.push(() => target.removeEventListener(type, listener, options));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderGeneration++;
    if (this.measureTimer !== null) window.clearTimeout(this.measureTimer);
    this.measureCancel?.();
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    if (this.fastReadDrawTimer !== null) window.clearTimeout(this.fastReadDrawTimer);
    this.fastReadDrawCancel?.();
    this.fastReadBuildCancel?.();
    this.fastReadBuildGeneration++;
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    for (const cleanup of this.cleanupCallbacks.splice(0)) cleanup();
    if (this.renderChild) {
      this.plugin.removeChild(this.renderChild);
      this.renderChild = null;
    }
    this.viewportEl.remove();
    this.containerEl.classList.remove("nmp-active");
  }
}

export default class NativeMarkdownPaginatorPlugin extends Plugin {
  settings: NativePaginatorSettings = { ...DEFAULT_SETTINGS };
  private readonly sessions = new Map<WorkspaceLeaf, PaginationSession>();
  private lastMarkdownView: MarkdownView | null = null;
  private syncTimer: number | null = null;
  private saveTimer: number | null = null;
  private workspaceObserver: MutationObserver | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addRibbonIcon("book-open", "切换原生分页阅读", () => void this.toggleCurrentFile());
    this.addCommand({
      id: "toggle-current-note",
      name: "切换当前笔记的原生分页阅读",
      callback: () => void this.toggleCurrentFile(),
    });
    this.addCommand({ id: "previous-page", name: "上一页", callback: () => this.getCurrentSession()?.previous() });
    this.addCommand({ id: "next-page", name: "下一页", callback: () => this.getCurrentSession()?.next() });
    this.addSettingTab(new NativePaginatorSettingTab(this));

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView) this.lastMarkdownView = leaf.view;
      this.scheduleSync();
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleSync()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleSync()));
    this.registerEvent(this.app.workspace.on("css-change", () => this.refreshSessions()));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      for (const session of this.sessions.values()) {
        if (session.filePath === file.path) session.reload();
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (moveReadingFileState(this.settings, oldPath, file.path)) this.queueSave();
      this.scheduleSync();
    }));
    this.registerDomEvent(window, "resize", () => this.scheduleSync());
    this.app.workspace.onLayoutReady(() => {
      this.workspaceObserver = new MutationObserver(() => this.scheduleSync());
      this.workspaceObserver.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
      this.scheduleSync();
    });
  }

  onunload(): void {
    if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.workspaceObserver?.disconnect();
    this.workspaceObserver = null;
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();
  }

  private async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<NativePaginatorSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      schemaVersion: SETTINGS_SCHEMA,
      enabledFiles: { ...(loaded?.enabledFiles ?? {}) },
      positions: { ...(loaded?.positions ?? {}) },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private queueSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 400);
  }

  setPosition(path: string, fraction: number): void {
    this.settings.positions[path] = fraction;
    this.queueSave();
  }

  refreshSessions(): void {
    for (const session of this.sessions.values()) session.refreshSettings();
  }

  refreshFastReadSessions(): void {
    for (const session of this.sessions.values()) session.refreshFastRead();
  }

  private getMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) {
      this.lastMarkdownView = active;
      return active;
    }
    if (this.lastMarkdownView?.containerEl.isConnected) return this.lastMarkdownView;
    return this.app.workspace.getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .find((view): view is MarkdownView => view instanceof MarkdownView && view.containerEl.getBoundingClientRect().width > 0)
      ?? null;
  }

  private async toggleCurrentFile(): Promise<void> {
    const view = this.getMarkdownView();
    const file = view?.file;
    if (!view || !file) {
      new Notice("请先打开一个 Markdown 笔记。", 5000);
      return;
    }

    const enabled = this.settings.enabledFiles[file.path] === true;
    const activeSession = Array.from(this.sessions.values()).some((session) => session.filePath === file.path);
    if (enabled && activeSession) {
      delete this.settings.enabledFiles[file.path];
      await this.saveSettings();
      this.scheduleSync();
      new Notice("已关闭当前笔记的分页阅读。", 2500);
      return;
    }

    this.settings.enabledFiles[file.path] = true;
    await this.saveSettings();
    if (view.getMode() !== "preview") {
      await view.setState({ ...view.getState(), mode: "preview" }, { history: false });
    }
    this.lastMarkdownView = view;
    this.scheduleSync();
    new Notice("已开启 MD Reader 风格的原生分页阅读。", 2500);
  }

  private scheduleSync(): void {
    if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null;
      this.syncViews();
    }, 120);
  }

  private syncViews(): void {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    const liveLeaves = new Set(markdownLeaves);
    for (const [leaf, session] of this.sessions) {
      const view = leaf.view;
      const shouldRemain = liveLeaves.has(leaf)
        && view instanceof MarkdownView
        && view.file !== null
        && view.containerEl.getBoundingClientRect().width > 0
        && view.getMode() === "preview"
        && this.settings.enabledFiles[view.file.path] === true
        && session.isMountedFor(view);
      if (!shouldRemain) {
        session.destroy();
        this.sessions.delete(leaf);
      }
    }

    let needsRetry = false;
    for (const leaf of markdownLeaves) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      const view = leaf.view;
      if (
        view.file
        && view.containerEl.getBoundingClientRect().width > 0
        && this.settings.enabledFiles[view.file.path] === true
        && view.getMode() === "preview"
        && !this.sessions.has(leaf)
      ) {
        const session = PaginationSession.create(this, view);
        if (session) this.sessions.set(leaf, session);
        else needsRetry = true;
      }
    }
    if (needsRetry) this.syncTimer = window.setTimeout(() => this.syncViews(), 250);
  }

  private getCurrentSession(): PaginationSession | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf) {
      const active = this.sessions.get(activeLeaf);
      if (active) return active;
    }
    const lastPath = this.lastMarkdownView?.file?.path;
    if (lastPath) {
      for (const session of this.sessions.values()) {
        if (session.filePath === lastPath) return session;
      }
    }
    return this.sessions.values().next().value ?? null;
  }
}

class NativePaginatorSettingTab extends PluginSettingTab {
  private readonly plugin: NativeMarkdownPaginatorPlugin;

  constructor(plugin: NativeMarkdownPaginatorPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Native Markdown Paginator" });
    containerEl.createEl("p", {
      text: "复用 MD Reader 的固定书页几何与 translateX 翻页，但仍保留标准 MarkdownView 和右侧插件面板。",
    });

    new Setting(containerEl).setName("页面").setHeading();
    new Setting(containerEl)
      .setName("页面模式")
      .setDesc("自动模式在可用宽度达到 820px 时显示双页。")
      .addDropdown((dropdown) => dropdown
        .addOptions({ auto: "自动", single: "始终单页", double: "始终双页" })
        .setValue(this.plugin.settings.pageMode)
        .onChange(async (value) => {
          this.plugin.settings.pageMode = value as PageMode;
          await this.saveAndRefresh();
        }));
    new Setting(containerEl)
      .setName("单页最大宽度")
      .addSlider((slider) => slider.setLimits(0, 1000, 20).setDynamicTooltip()
        .setValue(this.plugin.settings.maxPageWidth)
        .onChange(async (value) => {
          this.plugin.settings.maxPageWidth = value;
          await this.saveAndRefresh();
        }));
    new Setting(containerEl)
      .setName("页间距")
      .addSlider((slider) => slider.setLimits(0.5, 5, 0.25).setDynamicTooltip()
        .setValue(this.plugin.settings.columnGap)
        .onChange(async (value) => {
          this.plugin.settings.columnGap = value;
          await this.saveAndRefresh();
        }));
    new Setting(containerEl)
      .setName("上下页边距")
      .addSlider((slider) => slider.setLimits(0, 4, 0.1).setDynamicTooltip()
        .setValue(this.plugin.settings.verticalPadding)
        .onChange(async (value) => {
          this.plugin.settings.verticalPadding = value;
          await this.saveAndRefresh();
        }));

    new Setting(containerEl).setName("文字与颜色").setHeading();
    new Setting(containerEl)
      .setName("阅读字体")
      .addText((text) => text.setValue(this.plugin.settings.fontFamily).onChange(async (value) => {
        this.plugin.settings.fontFamily = value.trim() || DEFAULT_SETTINGS.fontFamily;
        await this.saveAndRefresh();
      }));
    new Setting(containerEl)
      .setName("字号")
      .addSlider((slider) => slider.setLimits(0.75, 1.8, 0.05).setDynamicTooltip()
        .setValue(this.plugin.settings.fontSize)
        .onChange(async (value) => {
          this.plugin.settings.fontSize = value;
          await this.saveAndRefresh();
        }));
    new Setting(containerEl)
      .setName("行距")
      .addSlider((slider) => slider.setLimits(1.2, 2.4, 0.05).setDynamicTooltip()
        .setValue(this.plugin.settings.lineHeight)
        .onChange(async (value) => {
          this.plugin.settings.lineHeight = value;
          await this.saveAndRefresh();
        }));
    new Setting(containerEl)
      .setName("页面色调")
      .addDropdown((dropdown) => dropdown
        .addOptions({ none: "跟随主题", sepia: "羊皮纸", cream: "米白", gray: "灰纸", night: "夜间" })
        .setValue(this.plugin.settings.tint)
        .onChange(async (value) => {
          this.plugin.settings.tint = value as PageTint;
          await this.saveAndRefresh();
        }));

    new Setting(containerEl).setName("翻页").setHeading();
    new Setting(containerEl).setName("翻页动画").addToggle((toggle) => toggle
      .setValue(this.plugin.settings.animate)
      .onChange(async (value) => {
        this.plugin.settings.animate = value;
        await this.saveAndRefresh();
      }));
    new Setting(containerEl).setName("滚轮翻页").addToggle((toggle) => toggle
      .setValue(this.plugin.settings.wheelPaging)
      .onChange(async (value) => {
        this.plugin.settings.wheelPaging = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("点击页面边缘翻页")
      .setDesc("左侧 30% 上一页，右侧 30% 下一页；链接和文本选择不会触发。")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.edgeClickPaging).onChange(async (value) => {
        this.plugin.settings.edgeClickPaging = value;
        await this.plugin.saveSettings();
      }));
  }

  private async saveAndRefresh(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.refreshSessions();
  }
}
